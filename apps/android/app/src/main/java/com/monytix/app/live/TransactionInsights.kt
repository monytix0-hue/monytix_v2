package com.monytix.app.live

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.shell.Money
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace
import com.monytix.app.theme.PersonalTokens
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.abs
import org.json.JSONObject

// MARK: - Models

internal data class InsightSlice(val id: String, val name: String, val amount: Double)

internal data class InsightCategory(
    val code: String,
    val name: String,
    val total: Double,
    val subcategories: List<InsightSlice>,
) {
    val isRecorded: Boolean get() = code != "none"
}

internal data class InsightMonth(
    val month: String,
    val credit: Double,
    val debit: Double,
    val opening: Double,
    val closing: Double,
)

internal data class InsightTotals(
    val credit: Double = 0.0,
    val debit: Double = 0.0,
    val categorisedOutflow: Double = 0.0,
    val uncategorisedOutflow: Double = 0.0,
)

internal data class LedgerInsights(
    val uncategorised: Int,
    val currency: String?,
    val totals: InsightTotals,
    val months: List<InsightMonth>,
    val categories: List<InsightCategory>,
) {
    val hasSummary: Boolean get() = months.isNotEmpty()
    val hasSpending: Boolean get() = categories.any { it.total > 0 }
    val spendingTotal: Double get() = categories.sumOf { it.total }
    val categorisedTotal: Double get() = categories.filter { it.isRecorded }.sumOf { it.total }

    /** True when categorised plus uncategorised outflow reconciles with the recorded outflow. */
    val reconciles: Boolean get() = totals.debit <= 0 || kotlin.math.abs(spendingTotal - totals.debit) < 0.01

    companion object {
        val empty = LedgerInsights(0, null, InsightTotals(), emptyList(), emptyList())

        fun parse(json: String?): LedgerInsights? {
            if (json.isNullOrBlank()) return null
            return runCatching { parse(JSONObject(json)) }.getOrNull()
        }

        fun parse(root: JSONObject): LedgerInsights {
            val uncategorised = root.optInt("uncategorised", 0)
            val currency = root.optString("currency").trim().takeUnless { it.isEmpty() }
            val totalsRow = root.optJSONObject("totals")
            val totals = InsightTotals(
                credit = totalsRow.number("credit"),
                debit = totalsRow.number("debit"),
                categorisedOutflow = totalsRow.number("categorisedOutflow"),
                uncategorisedOutflow = totalsRow.number("uncategorisedOutflow"),
            )

            val months = buildList {
                val rows = root.optJSONArray("monthlySummary")
                if (rows != null) {
                    for (index in 0 until rows.length()) {
                        val row = rows.optJSONObject(index) ?: continue
                        val month = row.optString("month")
                        if (month.isBlank()) continue
                        add(
                            InsightMonth(
                                month = month,
                                credit = row.number("credit"),
                                debit = row.number("debit"),
                                opening = row.number("openingBalance"),
                                closing = row.number("closingBalance"),
                            ),
                        )
                    }
                }
            }

            val analysis = root.optJSONObject("spendingAnalysis")?.optJSONObject("categories")
            val categories = buildList {
                val keys = analysis?.keys() ?: return@buildList
                while (keys.hasNext()) {
                    val code = keys.next()
                    val body = analysis.optJSONObject(code) ?: continue
                    val total = body.number("totalAmount")
                    if (total <= 0) continue
                    val names = body.optJSONObject("subcategoryNames")
                    val subs = body.optJSONObject("subcategories")
                    val slices = buildList {
                        val subKeys = subs?.keys() ?: return@buildList
                        while (subKeys.hasNext()) {
                            val subCode = subKeys.next()
                            val amount = subs.number(subCode)
                            if (amount <= 0) continue
                            val name = names?.optString(subCode)?.takeUnless { it.isBlank() } ?: subCode
                            add(InsightSlice("$code|$subCode", name, amount))
                        }
                    }.sortedByDescending { it.amount }
                    add(
                        InsightCategory(
                            code = code,
                            name = body.optString("name").ifBlank { if (code == "none") "Not recorded" else code },
                            total = total,
                            subcategories = slices,
                        ),
                    )
                }
            }.sortedByDescending { it.total }

            return LedgerInsights(uncategorised, currency, totals, months, categories)
        }
    }
}

private fun JSONObject?.number(key: String): Double {
    if (this == null || !has(key) || isNull(key)) return 0.0
    return when (val value: Any? = opt(key)) {
        is Number -> value.toDouble()
        is String -> value.replace(",", "").toDoubleOrNull() ?: 0.0
        else -> 0.0
    }
}

// MARK: - Formatting

internal fun insightMonthLabel(value: String): String = runCatching {
    YearMonth.parse(value).format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()))
}.getOrDefault(value)

/**
 * A booked figure in the report's own currency.
 *
 * `currency` is the insights payload's `currency`: the booked currency the slices
 * are actually in. It is never the display currency, because a pie chart that
 * silently mixes two currencies cannot reconcile. The separator comes from the
 * owner's locale, so `en_IN` still groups by lakh without the app slicing digits.
 */
internal fun insightMoney(
    value: Double,
    currency: String?,
    signed: Boolean = false,
    locale: Locale = Locale.getDefault(),
    minorUnits: Int? = null,
): String {
    val magnitude = Money.format(
        java.math.BigDecimal.valueOf(abs(value)),
        currency = currency,
        locale = locale,
        minorUnits = minorUnits,
    )
    if (!signed) return magnitude
    // The minus belongs in front of the whole figure, not inside the symbol position.
    val sign = if (value < 0) "−" else "+"
    return "$sign$magnitude"
}

/**
 * A compact figure for a card heading: `₹1.8L`, `$14.2k`.
 *
 * The scale word follows the currency's own grouping, so rupees keep lakh and
 * dollars do not gain a `L` they never use.
 */
internal fun insightCompact(
    value: Double,
    currency: String?,
    locale: Locale = Locale.getDefault(),
): String = Money.compact(java.math.BigDecimal.valueOf(value), currency, locale)

// MARK: - Month summary carousel

@Composable
internal fun MonthSummaryCarousel(
    months: List<InsightMonth>,
    currency: String?,
    locale: Locale = Locale.getDefault(),
    minorUnits: Int? = null,
) {
    val theme = LocalPersonalTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
        Text(
            "Month wise",
            color = theme.palette.textSecondary,
            fontFamily = theme.fontFamily,
            fontSize = 13.sp,
            modifier = Modifier.padding(horizontal = PersonalSpace.s4),
        )
        if (months.isEmpty()) {
            InsightCard {
                Text(
                    "No recorded months yet",
                    color = theme.palette.textPrimary,
                    fontFamily = theme.fontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
                Text(
                    "Once transactions are recorded, monthly credit, debit and balances appear here.",
                    color = theme.palette.textSecondary,
                    fontFamily = theme.fontFamily,
                    fontSize = 13.sp,
                )
            }
        } else {
            Row(
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = PersonalSpace.s4),
                horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
            ) {
                months.forEach { month ->
                    MonthCard(month, currency, locale = locale, minorUnits = minorUnits)
                }
            }
        }
    }
}

@Composable
private fun MonthCard(
    month: InsightMonth,
    currency: String?,
    locale: Locale = Locale.getDefault(),
    minorUnits: Int? = null,
) {
    val theme = LocalPersonalTheme.current
    val rising = month.closing >= month.opening
    val balanceTint = if (rising) {
        if (theme.isDark) PersonalTokens.status.mint else theme.palette.accent
    } else {
        if (theme.isDark) PersonalTokens.status.coralBorder else theme.palette.textPrimary
    }
    Box(
        Modifier
            .width(232.dp)
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    insightMonthLabel(month.month),
                    color = theme.palette.textPrimary,
                    fontFamily = theme.fontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    if (rising) "Up" else "Down",
                    color = theme.palette.textSecondary,
                    fontFamily = theme.fontFamily,
                    fontSize = 12.sp,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s16)) {
                MonthAmount("Credit", month.credit, currency, if (theme.isDark) PersonalTokens.status.mint else theme.palette.accent, Modifier.weight(1f))
                MonthAmount("Debit", month.debit, currency, theme.palette.textPrimary, Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s16)) {
                MonthAmount("Opening", month.opening, currency, theme.palette.textPrimary, Modifier.weight(1f))
                MonthAmount("Closing", month.closing, currency, theme.palette.textPrimary, Modifier.weight(1f))
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(theme.palette.divider),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s6)) {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(balanceTint),
                )
                Text(
                    "Net ${insightMoney(month.closing - month.opening, currency, signed = true, locale = locale, minorUnits = minorUnits)}",
                    color = theme.palette.textSecondary,
                    fontFamily = theme.fontFamily,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun MonthAmount(label: String, value: Double, currency: String?, tint: Color, modifier: Modifier = Modifier) {
    val theme = LocalPersonalTheme.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 12.sp)
        Text(
            insightCompact(value, currency),
            color = tint,
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
            maxLines = 1,
        )
    }
}

// MARK: - Spending chart

@Composable
internal fun SpendingChartCard(
    insights: LedgerInsights,
    locale: Locale = Locale.getDefault(),
    minorUnits: Int? = null,
    onReviewUncategorised: () -> Unit,
) {
    val theme = LocalPersonalTheme.current
    val context = LocalContext.current
    val animationsEnabled = remember(context) {
        kotlin.runCatching {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
        }.getOrDefault(true)
    }
    var drillCode by remember { mutableStateOf<String?>(null) }
    val reveal = remember { Animatable(0f) }
    val drilled = drillCode?.let { code -> insights.categories.firstOrNull { it.code == code } }

    val slices = if (drilled != null && drilled.subcategories.isNotEmpty()) {
        drilled.subcategories
    } else {
        insights.categories.map { InsightSlice(it.code, it.name, it.total) }
    }
    val total = if (drilled != null && drilled.subcategories.isNotEmpty()) drilled.total else insights.spendingTotal

    LaunchedEffect(drillCode, insights) {
        if (animationsEnabled) {
            reveal.snapTo(0f)
            reveal.animateTo(1f, tween(700, easing = FastOutSlowInEasing))
        } else {
            reveal.snapTo(1f)
        }
    }

    InsightCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    drilled?.let { "${it.name} subcategories" } ?: "Spending by category",
                    color = theme.palette.textPrimary,
                    fontFamily = theme.fontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
                Text(
                    "Outflow in the selected dates",
                    color = theme.palette.textSecondary,
                    fontFamily = theme.fontFamily,
                    fontSize = 12.sp,
                )
            }
            if (drilled != null) {
                Text(
                    "All",
                    color = theme.palette.accent,
                    fontFamily = theme.fontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(PersonalRadius.pill))
                        .background(theme.palette.surfaceRaised)
                        .clickable { drillCode = null }
                        .padding(horizontal = PersonalSpace.s12, vertical = PersonalSpace.s6),
                )
            }
        }

        if (!insights.hasSpending || slices.isEmpty()) {
            Text(
                "No categorised outflow in this view.",
                color = theme.palette.textSecondary,
                fontFamily = theme.fontFamily,
                fontSize = 13.sp,
            )
        } else {
            SpendingPie(
                slices = slices,
                total = total,
                currency = insights.currency,
                centerLabel = drilled?.name ?: "Total outflow",
                progress = reveal.value,
                locale = locale,
                onSliceTap = { slice ->
                    val code = slice.id.substringBefore("|")
                    val category = insights.categories.firstOrNull { it.code == code }
                    if (drilled == null && category != null && category.subcategories.isNotEmpty()) {
                        drillCode = category.code
                    }
                },
            )
            if (drilled == null && insights.totals.uncategorisedOutflow > 0) {
                Text(
                    "${percentText(insights.totals.uncategorisedOutflow, insights.totals.debit)} of recorded outflow has no category yet.",
                    color = theme.palette.textSecondary,
                    fontFamily = theme.fontFamily,
                    fontSize = 12.sp,
                )
            }
            if (drilled == null && insights.totals.debit > 0) {
                Text(
                    if (insights.reconciles) {
                        "Slices match the ${insightMoney(insights.totals.debit, insights.currency, locale = locale, minorUnits = minorUnits)} recorded outflow."
                    } else {
                        "Slices cover ${insightMoney(insights.spendingTotal, insights.currency, locale = locale, minorUnits = minorUnits)} of ${insightMoney(insights.totals.debit, insights.currency, locale = locale, minorUnits = minorUnits)} recorded outflow."
                    },
                    color = theme.palette.textSecondary,
                    fontFamily = theme.fontFamily,
                    fontSize = 12.sp,
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
                slices.forEachIndexed { index, slice ->
                    val category = insights.categories.firstOrNull { it.code == slice.id }
                    val drillable = drilled == null && category != null && category.subcategories.isNotEmpty()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(PersonalRadius.action))
                            .then(
                                if (drillable) Modifier.clickable { drillCode = category.code } else Modifier,
                            )
                            .padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
                    ) {
                        Box(
                            Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(insightColor(index, theme.isDark)),
                        )
                        Text(
                            slice.name,
                            color = theme.palette.textPrimary,
                            fontFamily = theme.fontFamily,
                            fontSize = 14.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            insightMoney(slice.amount, insights.currency, locale = locale, minorUnits = minorUnits),
                            color = theme.palette.textPrimary,
                            fontFamily = theme.fontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                        )
                        Text(
                            percentText(slice.amount, total),
                            color = theme.palette.textSecondary,
                            fontFamily = theme.fontFamily,
                            fontSize = 12.sp,
                            textAlign = TextAlign.End,
                            modifier = Modifier.width(44.dp),
                        )
                    }
                }
            }
        }

        if (insights.uncategorised > 0) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(PersonalRadius.action))
                    .background(theme.palette.surfaceRaised)
                    .clickable(onClick = onReviewUncategorised)
                    .padding(PersonalSpace.s12),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
            ) {
                Text(
                    "${insights.uncategorised} transaction${if (insights.uncategorised == 1) "" else "s"} need a category — review this",
                    color = theme.palette.textPrimary,
                    fontFamily = theme.fontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun SpendingPie(
    slices: List<InsightSlice>,
    total: Double,
    currency: String?,
    centerLabel: String,
    progress: Float,
    locale: Locale = Locale.getDefault(),
    onSliceTap: (InsightSlice) -> Unit,
) {
    val theme = LocalPersonalTheme.current
    val colors = slices.indices.map { insightColor(it, theme.isDark) }
    var canvasSize by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    var tapPoint by remember { mutableStateOf<Offset?>(null) }

    LaunchedEffect(tapPoint, canvasSize) {
        val point = tapPoint ?: return@LaunchedEffect
        tapPoint = null
        val index = sliceIndexAt(point, canvasSize, slices, total) ?: return@LaunchedEffect
        onSliceTap(slices[index])
    }

    Box(contentAlignment = Alignment.Center) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(200.dp)
                .onSizeChanged { canvasSize = it }
                .pointerInput(slices, total) {
                    detectTapGestures { offset -> tapPoint = offset }
                },
        ) {
            val diameter = minOf(size.width, size.height)
            // The ring is centred on a path of radius 0.4 * diameter, matching the 0.6 inner ratio on iOS.
            val ring = diameter * 0.20f
            val arcSize = Size(diameter - ring, diameter - ring)
            val topLeft = Offset((size.width - arcSize.width) / 2, (size.height - arcSize.height) / 2)
            val stroke = Stroke(width = ring, cap = StrokeCap.Butt)

            if (total <= 0) {
                drawArc(
                    color = theme.palette.border,
                    startAngle = -90f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = stroke,
                )
                return@Canvas
            }

            val gap = if (slices.size > 1) 2f else 0f
            var start = -90f
            slices.forEachIndexed { index, slice ->
                val full = (slice.amount / total).toFloat() * 360f
                val sweep = (full - gap) * progress
                if (sweep > 0f) {
                    drawArc(
                        color = colors[index],
                        startAngle = start + gap / 2,
                        sweepAngle = sweep,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = stroke,
                    )
                }
                start += full
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                insightCompact(total, currency, locale),
                color = theme.palette.textPrimary,
                fontFamily = theme.fontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
            )
            Text(
                centerLabel,
                color = theme.palette.textSecondary,
                fontFamily = theme.fontFamily,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

private fun sliceIndexAt(
    point: Offset,
    size: androidx.compose.ui.unit.IntSize,
    slices: List<InsightSlice>,
    total: Double,
): Int? {
    if (total <= 0 || slices.isEmpty() || size.width == 0 || size.height == 0) return null
    val dx = point.x - size.width / 2f
    val dy = point.y - size.height / 2f
    val distance = hypot(dx, dy)
    val diameter = minOf(size.width, size.height).toFloat()
    // Taps inside the donut hole or outside the ring are ignored.
    if (distance < diameter * 0.30f || distance > diameter / 2f) return null
    val rawAngle = Math.toDegrees(atan2(dy.toDouble(), dx.toDouble())).toFloat()
    val normalized = ((rawAngle + 90f) % 360f + 360f) % 360f
    var running = 0.0
    slices.forEachIndexed { index, slice ->
        running += slice.amount
        if (normalized <= (running / total) * 360f) return index
    }
    return slices.lastIndex
}

private fun percentText(amount: Double, total: Double): String {
    if (total <= 0) return "0%"
    return String.format(Locale.getDefault(), "%.0f%%", (amount / total) * 100)
}

internal fun insightColor(index: Int, dark: Boolean): Color {
    val palette = if (dark) {
        listOf(
            Color(0xFF57F1DB), Color(0xFFF7C663), Color(0xFFA98BF5), Color(0xFFFF9F86),
            Color(0xFF7FB2FF), Color(0xFF8BD7C0), Color(0xFFE5AA38), Color(0xFFCDB9F3),
        )
    } else {
        listOf(
            Color(0xFF003731), Color(0xFFE5AA38), Color(0xFF7C5CD6), Color(0xFFE2765B),
            Color(0xFF2F6FD0), Color(0xFF4FAF95), Color(0xFFB8860B), Color(0xFF9B86C4),
        )
    }
    return palette[index % palette.size]
}

@Composable
private fun InsightCard(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
        content = content,
    )
}
