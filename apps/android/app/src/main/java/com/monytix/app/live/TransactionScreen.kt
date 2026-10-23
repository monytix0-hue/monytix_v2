package com.monytix.app.live

import android.app.DatePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.R
import com.monytix.app.auth.MonytixApi
import com.monytix.app.theme.FigIcon
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace
import com.monytix.app.theme.PersonalTokens
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.launch
import org.json.JSONObject

private data class LedgerTransaction(
    val id: String,
    val amount: String?,
    val currency: String?,
    val direction: String?,
    val transactionDate: String?,
    val description: String?,
    val categoryName: String?,
    val subcategoryName: String?,
    val accountName: String?,
    val reference: String?,
)

private data class FilterChoice(val code: String, val name: String)

private data class CategoryChoice(val code: String, val name: String, val subcategories: List<FilterChoice>)

private data class LedgerPage(val items: List<LedgerTransaction>, val nextCursor: String?, val known: Boolean)

@Composable
fun TransactionScreen(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    onBack: () -> Unit,
) {
    val theme = LocalPersonalTheme.current
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf(listOf<LedgerTransaction>()) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var categories by remember { mutableStateOf(listOf<CategoryChoice>()) }
    var direction by remember { mutableStateOf<String?>(null) }
    var category by remember { mutableStateOf<String?>(null) }
    var subcategory by remember { mutableStateOf<String?>(null) }
    var from by remember { mutableStateOf<String?>(null) }
    var to by remember { mutableStateOf<String?>(null) }
    var dateLabel by remember { mutableStateOf("All dates") }
    var categoriesOpen by remember { mutableStateOf(false) }
    var showDates by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<LedgerTransaction?>(null) }
    var known by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    val filtered = direction != null || category != null || from != null || to != null
    val query = listOf(direction, from, to, category, subcategory).joinToString("|")
    val credit = if (theme.isDark) PersonalTokens.status.mint else theme.palette.accent

    LaunchedEffect(Unit) {
        categories = parseFilters(api.getJson("/v1/transaction-filters", token))
    }
    LaunchedEffect(query) {
        loading = true
        items = emptyList()
        nextCursor = null
        val page = loadPage(api, token, direction, from, to, category, subcategory, null)
        items = page.items
        nextCursor = page.nextCursor
        known = page.known
        loading = false
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(theme.palette.canvas),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = PersonalSpace.s20)
                .padding(top = PersonalSpace.s16, bottom = PersonalSpace.s32),
            verticalArrangement = Arrangement.spacedBy(PersonalSpace.s16),
        ) {
            LedgerBackBar("Transactions", "Recorded activity", onBack)
            LedgerCard {
                Text("Recorded activity", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                Text(
                    when {
                        !known -> "Unavailable"
                        items.isEmpty() && filtered -> "No transactions in this view"
                        items.isEmpty() -> "No recorded transactions"
                        else -> "Recorded"
                    },
                    color = theme.palette.textPrimary,
                    fontFamily = theme.fontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
            }
            FilterRail {
                LedgerChip(dateLabel, from != null) { showDates = true }
                LedgerChip("Credit", direction == "IN") { direction = if (direction == "IN") null else "IN" }
                LedgerChip("Debit", direction == "OUT") { direction = if (direction == "OUT") null else "OUT" }
                LedgerChip(categories.firstOrNull { it.code == category }?.name ?: "Category", category != null || categoriesOpen) {
                    categoriesOpen = !categoriesOpen
                }
            }
            if (categoriesOpen) {
                FilterRail {
                    categories.forEach { row ->
                        LedgerChip(row.name, category == row.code) {
                            if (category == row.code) {
                                category = null
                                subcategory = null
                            } else {
                                category = row.code
                                subcategory = null
                            }
                        }
                    }
                }
            }
            val chosen = categories.firstOrNull { it.code == category }
            if (category != null && category != "none" && chosen != null && chosen.subcategories.isNotEmpty()) {
                FilterRail {
                    chosen.subcategories.forEach { row ->
                        LedgerChip(row.name, subcategory == row.code) {
                            subcategory = if (subcategory == row.code) null else row.code
                        }
                    }
                }
            }
            if (loading && items.isEmpty()) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally), color = theme.palette.accent)
            } else if (items.isEmpty()) {
                LedgerCard {
                    Text(
                        if (known) {
                            if (filtered) "No transactions in this view." else "No recorded transactions"
                        } else {
                            "Unavailable"
                        },
                        color = theme.palette.textPrimary,
                        fontFamily = theme.fontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                    )
                }
            } else {
                items.groupBy { it.transactionDate ?: "" }.forEach { (date, rows) ->
                    Text(headingDate(date), color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                    rows.forEach { row ->
                        LedgerCard(Modifier.clickable { selected = row }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                FigIcon(mark(row.direction), 28.dp)
                                Spacer(Modifier.width(PersonalSpace.s12))
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        row.description ?: "Transaction",
                                        color = theme.palette.textPrimary,
                                        fontFamily = theme.fontFamily,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 16.sp,
                                    )
                                    if (!row.categoryName.isNullOrBlank()) {
                                        Text(row.categoryName, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                                    }
                                }
                                Spacer(Modifier.width(PersonalSpace.s8))
                                Text(
                                    statementMoney(row.currency, row.amount),
                                    color = if (row.direction == "IN") credit else theme.palette.textPrimary,
                                    fontFamily = theme.fontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 15.sp,
                                    textAlign = TextAlign.End,
                                )
                            }
                        }
                    }
                }
            }
            if (nextCursor != null) {
                Text(
                    if (loadingMore) "Loading" else "Show more",
                    color = theme.palette.accent,
                    fontFamily = theme.fontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = !loadingMore) {
                            val cursor = nextCursor ?: return@clickable
                            scope.launch {
                                loadingMore = true
                                val page = loadPage(api, token, direction, from, to, category, subcategory, cursor)
                                val seen = items.map { it.id }.toSet()
                                items = items + page.items.filter { it.id !in seen }
                                nextCursor = page.nextCursor
                                loadingMore = false
                            }
                        }
                        .padding(vertical = PersonalSpace.s12),
                )
            }
        }
        if (showDates) {
            DateSheet(
                onDismiss = { showDates = false },
                onApply = { start, end, label ->
                    from = start
                    to = end
                    dateLabel = label
                    showDates = false
                },
            )
        }
        selected?.let { row ->
            TransactionDetail(row, credit, onBack = { selected = null })
        }
    }
}

@Composable
private fun DateSheet(onDismiss: () -> Unit, onApply: (String?, String?, String) -> Unit) {
    val theme = LocalPersonalTheme.current
    val context = LocalContext.current
    var customFrom by remember { mutableStateOf(LocalDate.now().minusDays(29)) }
    var customTo by remember { mutableStateOf(LocalDate.now()) }
    Box(
        Modifier
            .fillMaxSize()
            .background(theme.palette.backdrop.copy(alpha = 0.72f))
            .clickable(onClick = onDismiss),
    ) {
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = PersonalRadius.sheet, topEnd = PersonalRadius.sheet))
                .background(theme.palette.sheet)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                .navigationBarsPadding()
                .padding(PersonalSpace.s20),
            verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
        ) {
            Text("Date", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            LedgerChip("All dates", false) { onApply(null, null, "All dates") }
            LedgerChip("This month", false) {
                val end = LocalDate.now()
                onApply(end.withDayOfMonth(1).toString(), end.toString(), "This month")
            }
            LedgerChip("Last 30 days", false) {
                val end = LocalDate.now()
                onApply(end.minusDays(29).toString(), end.toString(), "Last 30 days")
            }
            LedgerChip("Last 3 months", false) {
                val end = LocalDate.now()
                onApply(end.minusMonths(3).toString(), end.toString(), "Last 3 months")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
                LedgerChip(customFrom.format(mediumDate), false) {
                    pickDate(context, customFrom) { customFrom = it }
                }
                LedgerChip(customTo.format(mediumDate), false) {
                    pickDate(context, customTo) { customTo = it }
                }
            }
            LedgerChip("Apply dates", true) {
                val start = if (customFrom.isAfter(customTo)) customTo else customFrom
                val end = if (customFrom.isAfter(customTo)) customFrom else customTo
                onApply(start.toString(), end.toString(), "${start.format(mediumDate)} – ${end.format(mediumDate)}")
            }
        }
    }
}

@Composable
private fun TransactionDetail(row: LedgerTransaction, credit: androidx.compose.ui.graphics.Color, onBack: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        Modifier
            .fillMaxSize()
            .background(theme.palette.canvas)
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = PersonalSpace.s20)
            .padding(top = PersonalSpace.s16, bottom = PersonalSpace.s32),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s20),
    ) {
        LedgerBackBar("Transaction", "Recorded activity", onBack)
        LedgerCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                FigIcon(mark(row.direction), 28.dp)
                Spacer(Modifier.width(PersonalSpace.s12))
                Text(
                    statementMoney(row.currency, row.amount),
                    color = if (row.direction == "IN") credit else theme.palette.textPrimary,
                    fontFamily = theme.fontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 28.sp,
                )
            }
            Text(row.description ?: "Transaction", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(PersonalRadius.card))
                .background(theme.palette.surface)
                .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card)),
        ) {
            Fact("Date", headingDate(row.transactionDate ?: ""))
            Fact("Type", if (row.direction == "IN") "Credit" else if (row.direction == "OUT") "Debit" else "Not recorded")
            Fact("Category", recorded(row.categoryName))
            Fact("Subcategory", recorded(row.subcategoryName))
            Fact("Account", recorded(row.accountName))
            Fact("Reference", recorded(row.reference))
        }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    val theme = LocalPersonalTheme.current
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = PersonalSpace.s16, vertical = PersonalSpace.s12),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        Spacer(Modifier.width(PersonalSpace.s12))
        Text(
            value,
            color = theme.palette.textPrimary,
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun LedgerBackBar(title: String, subtitle: String, onBack: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
        Box(
            modifier = Modifier
                .height(40.dp)
                .width(40.dp)
                .clip(CircleShape)
                .background(theme.palette.surface)
                .border(1.dp, theme.palette.border, CircleShape)
                .clickable(onClick = onBack),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = theme.palette.textPrimary)
        }
        Column {
            Text(title, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text(subtitle, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        }
    }
}

@Composable
private fun FilterRail(content: @Composable () -> Unit) {
    Row(
        Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
        content = { content() },
    )
}

@Composable
private fun LedgerChip(label: String, on: Boolean, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Text(
        label,
        color = if (on) theme.action.label else theme.palette.textSecondary,
        fontFamily = theme.fontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(PersonalRadius.pill))
            .background(if (on) theme.action.default else theme.palette.surface)
            .border(1.dp, if (on) theme.action.default else theme.palette.border, RoundedCornerShape(PersonalRadius.pill))
            .clickable(onClick = onClick)
            .padding(horizontal = PersonalSpace.s16, vertical = PersonalSpace.s12),
    )
}

@Composable
private fun LedgerCard(modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
        content = content,
    )
}

private fun mark(direction: String?): Int = when (direction) {
    "IN" -> R.drawable.fig_cash_arrow
    "OUT" -> R.drawable.fig_utensils
    else -> R.drawable.fig_tx_user
}

private fun recorded(value: String?): String = value?.trim().takeUnless { it.isNullOrEmpty() } ?: "Not recorded"

private val headingDateFormat: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.getDefault())
private val mediumDate: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault())

private fun headingDate(iso: String): String {
    if (iso.isBlank()) return "Not recorded"
    return runCatching { LocalDate.parse(iso).format(headingDateFormat) }.getOrDefault(iso)
}

private fun statementMoney(currency: String?, amount: String?): String {
    val code = currency?.trim().orEmpty()
    val value = amount?.replace(",", "")?.toDoubleOrNull() ?: return "Not recorded"
    val number = java.text.NumberFormat.getNumberInstance(Locale.getDefault()).apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
    }
    val text = number.format(value)
    return if (code.isEmpty()) text else "$code $text"
}

private fun pickDate(context: android.content.Context, initial: LocalDate, onPicked: (LocalDate) -> Unit) {
    DatePickerDialog(
        context,
        { _, year, month, day -> onPicked(LocalDate.of(year, month + 1, day)) },
        initial.year,
        initial.monthValue - 1,
        initial.dayOfMonth,
    ).show()
}

private suspend fun loadPage(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    direction: String?,
    from: String?,
    to: String?,
    category: String?,
    subcategory: String?,
    cursor: String?,
): LedgerPage {
    val query = buildString {
        append("/v1/transactions?limit=30")
        if (direction != null) append("&direction=").append(direction)
        if (from != null) append("&from=").append(from)
        if (to != null) append("&to=").append(to)
        if (category != null) append("&category=").append(category)
        if (subcategory != null) append("&subcategory=").append(subcategory)
        if (cursor != null) append("&cursor=").append(java.net.URLEncoder.encode(cursor, Charsets.UTF_8.name()))
    }
    val json = api.getJson(query, token) ?: return LedgerPage(emptyList(), null, false)
    return parsePage(json)
}

private fun parsePage(json: String): LedgerPage {
    val root = JSONObject(json)
    val rows = root.optJSONArray("items")
    val items = buildList {
        if (rows != null) {
            for (index in 0 until rows.length()) {
                val row = rows.optJSONObject(index) ?: continue
                val id = row.optString("logicalTransactionId")
                if (id.isBlank()) continue
                add(
                    LedgerTransaction(
                        id = id,
                        amount = row.optString("amount").ifBlank { null },
                        currency = row.optString("currency").trim().ifBlank { null },
                        direction = row.optString("direction").ifBlank { null },
                        transactionDate = row.optString("transactionDate").ifBlank { null },
                        description = row.optString("description").ifBlank { null },
                        categoryName = row.optString("categoryName").ifBlank { null },
                        subcategoryName = row.optString("subcategoryName").ifBlank { null },
                        accountName = row.optString("accountName").ifBlank { null },
                        reference = row.optString("reference").ifBlank { null },
                    ),
                )
            }
        }
    }
    val cursor = if (root.isNull("nextCursor")) null else root.optString("nextCursor").ifBlank { null }
    return LedgerPage(items, cursor, true)
}

private fun parseFilters(json: String?): List<CategoryChoice> {
    if (json.isNullOrBlank()) return emptyList()
    val rows = JSONObject(json).optJSONArray("categories") ?: return emptyList()
    return buildList {
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            val code = row.optString("code")
            if (code.isBlank()) continue
            val subs = row.optJSONArray("subcategories")
            val subcategories = buildList {
                if (subs != null) {
                    for (subIndex in 0 until subs.length()) {
                        val sub = subs.optJSONObject(subIndex) ?: continue
                        val subCode = sub.optString("code")
                        if (subCode.isNotBlank()) add(FilterChoice(subCode, sub.optString("name").ifBlank { subCode }))
                    }
                }
            }
            add(CategoryChoice(code, row.optString("name").ifBlank { code }, subcategories))
        }
    }
}
