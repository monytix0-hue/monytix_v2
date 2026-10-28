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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.R
import com.monytix.app.auth.MonytixApi
import com.monytix.app.shell.UiSessionStore
import com.monytix.app.theme.FigIcon
import com.monytix.app.shell.Money
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
    val versionId: String?,
    val amount: String?,
    val currency: String?,
    val direction: String?,
    val transactionDate: String?,
    val description: String?,
    val categoryCode: String?,
    val categoryName: String?,
    val subcategoryCode: String?,
    val subcategoryName: String?,
    val accountName: String?,
    val weightCode: String?,
    val weightName: String?,
    val reference: String?,
    /** The *as stated* pair when the alert named a foreign amount. Null means same as booked. */
    val statedAmount: String? = null,
    val statedCurrency: String? = null,
    /** How the parser decided the booked currency, and how sure it was. */
    val currencyBasis: String? = null,
    val currencyConfidence: Double? = null,
    /** True when the ledger should offer the "Currency uncertain — review" row. */
    val currencyUncertain: Boolean = false,
)

/** Only the fields the user actually changed are sent back. */
private data class TransactionCorrection(
    val versionId: String?,
    val amount: String? = null,
    val direction: String? = null,
    val occurredAt: String? = null,
    val description: String? = null,
    val categoryCode: String? = null,
    val subcategoryCode: String? = null,
    val weightCode: String? = null,
) {
    fun isEmpty(): Boolean =
        amount == null && direction == null && occurredAt == null &&
            description == null && categoryCode == null && subcategoryCode == null &&
            weightCode == null
}

private data class TransactionDraft(
    val amount: String,
    val direction: String,
    val date: String,
    val description: String,
    val categoryCode: String?,
    val categoryName: String?,
    val subcategoryCode: String?,
    val subcategoryName: String?,
    val weightCode: String?,
    val weightName: String?,
) {
    companion object {
        fun from(row: LedgerTransaction) = TransactionDraft(
            amount = row.amount?.trim().orEmpty(),
            direction = row.direction.orEmpty(),
            date = row.transactionDate.orEmpty(),
            description = row.description.orEmpty(),
            categoryCode = row.categoryCode,
            categoryName = row.categoryName,
            subcategoryCode = row.subcategoryCode,
            subcategoryName = row.subcategoryName,
            weightCode = row.weightCode,
            weightName = row.weightName,
        )
    }

    /** The amount must stay a positive decimal, matching the ledger's own grammar. */
    fun error(): String? {
        val value = amount.trim()
        if (value.isEmpty()) return "Enter an amount."
        if (!Regex("""^(?:0|[1-9]\d*)(?:\.\d{1,4})?$""").matches(value)) return "Amount can have at most four decimals."
        if ((value.toDoubleOrNull() ?: 0.0) <= 0.0) return "Amount must be more than zero."
        if (direction != "IN" && direction != "OUT") return "Choose debit or credit."
        // A missing date is left alone rather than forced, so an old row without
        // one can still have its amount fixed.
        if (date.isNotBlank() && !Regex("""^\d{4}-\d{2}-\d{2}$""").matches(date)) return "Choose a date."
        if (description.isBlank()) return "Enter a description."
        return null
    }

    fun corrections(row: LedgerTransaction): TransactionCorrection {
        fun changed(next: String?, current: String?): String? =
            if ((next ?: "").trim() == (current ?: "").trim()) null else next?.trim()?.ifBlank { null }

        val nextCategory = changed(categoryCode, row.categoryCode)
        val nextSubcategory = changed(subcategoryCode, row.subcategoryCode)
        val occurredAt = if (date == row.transactionDate.orEmpty()) null else "${date}T00:00:00Z"
        return TransactionCorrection(
            versionId = row.versionId,
            amount = changed(amount, row.amount),
            direction = changed(direction, row.direction),
            occurredAt = occurredAt,
            description = changed(description, row.description),
            // The API refuses a subcategory without its category, so a subcategory
            // move always carries the category even when that part is unchanged.
            categoryCode = if (nextSubcategory != null) categoryCode?.trim()?.ifBlank { null } else nextCategory,
            subcategoryCode = nextSubcategory,
            weightCode = changed(weightCode, row.weightCode),
        )
    }
}


private data class FilterChoice(val code: String, val name: String)

private data class CategoryChoice(val code: String, val name: String, val subcategories: List<FilterChoice>)

private data class LedgerPage(val items: List<LedgerTransaction>, val nextCursor: String?, val known: Boolean)

@Composable
fun TransactionScreen(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    onBack: () -> Unit,
    store: UiSessionStore? = null,
) {
    val theme = LocalPersonalTheme.current
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf(listOf<LedgerTransaction>()) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var categories by remember { mutableStateOf(listOf<CategoryChoice>()) }
    var weights by remember { mutableStateOf(listOf<FilterChoice>()) }
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
    var insights by remember { mutableStateOf(LedgerInsights.empty) }
    var insightsKnown by remember { mutableStateOf(false) }
    var showInsights by remember { mutableStateOf(true) }
    val filtered = direction != null || category != null || from != null || to != null
    val query = listOf(direction, from, to, category, subcategory).joinToString("|")
    val insightQuery = listOf(from, to).joinToString("|")
    val credit = if (theme.isDark) PersonalTokens.status.mint else theme.palette.accent

    LaunchedEffect(Unit) {
        val filters = parseFilters(api.getJson("/v1/transaction-filters", token))
        categories = filters.categories
        weights = filters.weights
    }
    LaunchedEffect(insightQuery) {
        val json = store?.ledgerInsights(from, to) ?: api.getJson(insightsPath(from, to), token)
        val parsed = LedgerInsights.parse(json)
        if (parsed != null) {
            insights = parsed
            insightsKnown = true
        } else {
            insightsKnown = false
        }
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

    // A correction or a delete changes this page and the analytics behind the
    // insights cards, so both are reread from the server rather than patched locally.
    val refreshAfterWrite: suspend () -> Unit = {
        val filters = parseFilters(api.getJson("/v1/transaction-filters", token))
        categories = filters.categories
        weights = filters.weights
        val page = loadPage(api, token, direction, from, to, category, subcategory, null)
        items = page.items
        nextCursor = page.nextCursor
        known = page.known
        store?.invalidateInsights()
        val refreshed = store?.ledgerInsights(from, to) ?: api.getJson(insightsPath(from, to), token)
        LedgerInsights.parse(refreshed)?.let {
            insights = it
            insightsKnown = true
        }
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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
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
                    Text(
                        if (showInsights) "Hide insights" else "Show insights",
                        color = theme.palette.accent,
                        fontFamily = theme.fontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(PersonalRadius.pill))
                            .background(theme.palette.surfaceRaised)
                            .clickable { showInsights = !showInsights }
                            .padding(horizontal = PersonalSpace.s12, vertical = PersonalSpace.s6),
                    )
                }
                if (insightsKnown && insights.uncategorised > 0) {
                    Text(
                        "${insights.uncategorised} not categorised — review this",
                        color = theme.palette.textPrimary,
                        fontFamily = theme.fontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(PersonalRadius.action))
                            .clickable {
                                direction = null
                                category = "none"
                                subcategory = null
                                showInsights = true
                            }
                            .padding(vertical = PersonalSpace.s6),
                    )
                }
            }
            if (showInsights && insightsKnown) {
                MonthSummaryCarousel(
                    insights.months,
                    insights.currency,
                    locale = store?.preferences?.moneyLocale ?: Locale.getDefault(),
                    minorUnits = store?.minorUnits(insights.currency),
                )
                SpendingChartCard(
                    insights,
                    locale = store?.preferences?.moneyLocale ?: Locale.getDefault(),
                    minorUnits = store?.minorUnits(insights.currency),
                ) {
                    direction = null
                    category = "none"
                    subcategory = null
                    showInsights = true
                }
            }
            FilterRail {
                LedgerChip(dateLabel, from != null) { showDates = true }
                LedgerChip("Credit", direction == "IN") { direction = if (direction == "IN") null else "IN" }
                LedgerChip("Debit", direction == "OUT") { direction = if (direction == "OUT") null else "OUT" }
                LedgerChip("Uncategorised", category == "none") {
                    if (category == "none") {
                        category = null
                    } else {
                        category = "none"
                    }
                    subcategory = null
                }
                LedgerChip(
                    categories.firstOrNull { it.code == category }?.name ?: "Category",
                    (category != null && category != "none") || categoriesOpen,
                ) {
                    categoriesOpen = !categoriesOpen
                }
            }
            if (categoriesOpen) {
                FilterRail {
                    categories.filter { it.code != "none" }.forEach { row ->
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
                                    } else {
                                        Text(
                                            "Needs a category — review",
                                            color = theme.palette.accent,
                                            fontFamily = theme.fontFamily,
                                            fontWeight = FontWeight.SemiBold,
                                            fontSize = 13.sp,
                                        )
                                    }
                                    if (!row.accountName.isNullOrBlank()) {
                                        Text(row.accountName, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                                    }
                                    if (!row.weightName.isNullOrBlank()) {
                                        Text(row.weightName, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                                    }
                                    // A second, independent prompt: the category row above answers
                                    // "how is this grouped", this one answers "is the figure right".
                                    if (row.currencyUncertain) {
                                        Text(
                                            if (row.currency.isNullOrBlank()) {
                                                "Currency uncertain — review"
                                            } else {
                                                "Currency uncertain (${row.currency}) — review"
                                            },
                                            color = theme.palette.accent,
                                            fontFamily = theme.fontFamily,
                                            fontWeight = FontWeight.SemiBold,
                                            fontSize = 13.sp,
                                        )
                                    }
                                }
                                Spacer(Modifier.width(PersonalSpace.s8))
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(
                                        statementMoney(row.currency, row.amount, store),
                                        color = if (row.direction == "IN") credit else theme.palette.textPrimary,
                                        fontFamily = theme.fontFamily,
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 15.sp,
                                        textAlign = TextAlign.End,
                                    )
                                    // The stated side only appears when it differs from the booked
                                    // side, so an ordinary domestic alert stays one line.
                                    if (!row.statedCurrency.isNullOrBlank() && !row.statedAmount.isNullOrBlank()) {
                                        Text(
                                            statementMoney(row.statedCurrency, row.statedAmount, store),
                                            color = theme.palette.textSecondary,
                                            fontFamily = theme.fontFamily,
                                            fontSize = 12.sp,
                                            textAlign = TextAlign.End,
                                        )
                                    }
                                }
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
            TransactionDetail(
                row,
                credit,
                categories,
                weights,
                store = store,
                onBack = { selected = null },
                onSave = { correction ->
                    val ok = saveTransaction(api, token, row.id, correction)
                    if (ok) {
                        refreshAfterWrite()
                        selected = null
                    }
                    ok
                },
                onDelete = {
                    val ok = deleteTransaction(api, token, row.id)
                    if (ok) {
                        refreshAfterWrite()
                        selected = null
                    }
                    ok
                },
            )
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
private fun TransactionDetail(
    row: LedgerTransaction,
    credit: androidx.compose.ui.graphics.Color,
    categories: List<CategoryChoice>,
    weights: List<FilterChoice>,
    store: UiSessionStore? = null,
    onBack: () -> Unit,
    onSave: suspend (TransactionCorrection) -> Boolean,
    onDelete: suspend () -> Boolean,
) {
    val theme = LocalPersonalTheme.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var draft by remember(row.id) { mutableStateOf(TransactionDraft.from(row)) }
    var pickingCategory by remember { mutableStateOf(false) }
    var pickingWeight by remember { mutableStateOf(false) }
    var chosen by remember { mutableStateOf<CategoryChoice?>(null) }
    var saving by remember { mutableStateOf(false) }
    var confirmingDelete by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val dirty = draft != TransactionDraft.from(row)

    fun save() {
        val problem = draft.error()
        if (problem != null) {
            error = problem
            return
        }
        val correction = draft.corrections(row)
        if (correction.isEmpty()) {
            onBack()
            return
        }
        scope.launch {
            saving = true
            error = null
            val ok = onSave(correction)
            saving = false
            if (ok) onBack() else error = "The change could not be saved."
        }
    }

    Box(Modifier.fillMaxSize()) {
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
        LedgerBackBar(if (dirty) "Edit transaction" else "Transaction", "Recorded activity", onBack)
        LedgerCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                FigIcon(mark(draft.direction), 28.dp)
                Spacer(Modifier.width(PersonalSpace.s12))
                Text(
                    statementMoney(row.currency, draft.amount, store),
                    color = if (draft.direction == "IN") credit else theme.palette.textPrimary,
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
            EditRow("Amount", enabled = !saving) {
                EditField(
                    value = draft.amount,
                    placeholder = "0.00",
                    keyboard = KeyboardType.Decimal,
                    onValueChange = { draft = draft.copy(amount = it) },
                )
            }
            EditToggle("Type", enabled = !saving) {
                Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
                    LedgerChip("Debit", draft.direction == "OUT") { draft = draft.copy(direction = "OUT") }
                    LedgerChip("Credit", draft.direction == "IN") { draft = draft.copy(direction = "IN") }
                }
            }
            EditRow("Date", enabled = !saving) {
                LedgerChip(headingDate(draft.date), false) {
                    val initial = runCatching { LocalDate.parse(draft.date) }.getOrNull() ?: LocalDate.now()
                    pickDate(context, initial) { draft = draft.copy(date = it.toString()) }
                }
            }
            EditRow("Description", enabled = !saving) {
                EditField(
                    value = draft.description,
                    placeholder = "What was this?",
                    onValueChange = { draft = draft.copy(description = it) },
                )
            }
            EditRow("Category", enabled = categories.isNotEmpty() && !saving) {
                LedgerChip(recorded(draft.categoryName), false) {
                    chosen = null
                    pickingCategory = true
                }
            }
            EditRow("Subcategory", enabled = !saving) {
                Text(
                    recorded(draft.subcategoryName),
                    color = theme.palette.textSecondary,
                    fontFamily = theme.fontFamily,
                    fontSize = 15.sp,
                )
            }
            EditRow("Weight", enabled = weights.isNotEmpty() && !saving) {
                LedgerChip(recorded(draft.weightName), false) { pickingWeight = true }
            }
            Fact("Account", recorded(row.accountName))
            Fact("Reference", recorded(row.reference))
        }
        if (error != null) {
            Text(
                error.orEmpty(),
                color = theme.status.coralBorder,
                fontFamily = theme.fontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
            Text(
                if (saving) "Saving" else "Save changes",
                color = theme.action.label,
                fontFamily = theme.fontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(PersonalRadius.action))
                    .background(if (saving || !dirty) theme.action.disabledFill else theme.action.default)
                    .clickable(enabled = !saving && dirty) { save() }
                    .padding(vertical = PersonalSpace.s16),
            )
            Text(
                "Delete transaction",
                color = theme.status.coralBorder,
                fontFamily = theme.fontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(PersonalRadius.action))
                    .clickable(enabled = !saving) { confirmingDelete = true }
                    .padding(vertical = PersonalSpace.s12),
            )
        }
    }
    if (pickingCategory) {
        CategorySheet(
            categories = categories,
            chosen = chosen,
            onChooseCategory = { category ->
                if (category.subcategories.isEmpty()) {
                    draft = draft.copy(
                        categoryCode = category.code,
                        categoryName = category.name,
                        subcategoryCode = null,
                        subcategoryName = null,
                    )
                    pickingCategory = false
                } else {
                    chosen = category
                }
            },
            onChooseSubcategory = { category, sub ->
                draft = draft.copy(
                    categoryCode = category.code,
                    categoryName = category.name,
                    subcategoryCode = sub.code.takeUnless { it == "none" },
                    subcategoryName = sub.name.takeUnless { it == "Not recorded" },
                )
                pickingCategory = false
            },
            onBack = { chosen = null },
            onDismiss = { pickingCategory = false },
        )
    }
    if (pickingWeight) {
        ChoiceSheet(
            title = "Weight",
            choices = weights,
            onChoose = { choice ->
                draft = draft.copy(weightCode = choice.code, weightName = choice.name)
                pickingWeight = false
            },
            onDismiss = { pickingWeight = false },
        )
    }
    if (confirmingDelete) {
        DeleteDialog(
            description = row.description.orEmpty(),
            onDismiss = { confirmingDelete = false },
            onConfirm = {
                scope.launch {
                    saving = true
                    val ok = onDelete()
                    saving = false
                    confirmingDelete = false
                    if (ok) onBack() else error = "The transaction could not be deleted."
                }
            },
        )
    }
    }
}

@Composable
private fun EditRow(label: String, enabled: Boolean = true, content: @Composable () -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = PersonalSpace.s16, vertical = PersonalSpace.s12),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s6),
    ) {
        Text(label, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        Box(Modifier.alpha(if (enabled) 1f else 0.55f)) {
            content()
            if (!enabled) {
                // Swallow taps so a disabled row cannot open its sheet.
                Box(
                    Modifier
                        .matchParentSize()
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = {},
                        ),
                )
            }
        }
    }
}

@Composable
private fun EditToggle(label: String, enabled: Boolean = true, content: @Composable () -> Unit) {
    EditRow(label, enabled) { content() }
}

@Composable
private fun EditField(
    value: String,
    placeholder: String,
    keyboard: KeyboardType = KeyboardType.Text,
    onValueChange: (String) -> Unit,
) {
    val theme = LocalPersonalTheme.current
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = false,
        textStyle = TextStyle(
            color = theme.palette.textPrimary,
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
        ),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        cursorBrush = SolidColor(theme.palette.accent),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.action))
            .background(theme.palette.surfaceRaised)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.action))
            .padding(horizontal = PersonalSpace.s12, vertical = PersonalSpace.s12),
        decorationBox = { inner ->
            if (value.isEmpty()) {
                Text(placeholder, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            }
            inner()
        },
    )
}

@Composable
private fun ChoiceSheet(
    title: String,
    choices: List<FilterChoice>,
    onChoose: (FilterChoice) -> Unit,
    onDismiss: () -> Unit,
) {
    val theme = LocalPersonalTheme.current
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
                .verticalScroll(rememberScrollState())
                .padding(PersonalSpace.s20),
            verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
        ) {
            Text(title, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            for (choice in choices) {
                LedgerChip(choice.name, false) { onChoose(choice) }
            }
        }
    }
}

@Composable
private fun DeleteDialog(description: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val theme = LocalPersonalTheme.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text("Delete this transaction?", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        },
        text = {
            Text(
                "${description.ifBlank { "This transaction" }} will be removed for good. Its totals leave every summary and insight.",
                color = theme.palette.textSecondary,
                fontFamily = theme.fontFamily,
                fontSize = 15.sp,
            )
        },
        confirmButton = {
            Text(
                "Delete",
                color = theme.status.coralBorder,
                fontFamily = theme.fontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(PersonalRadius.pill))
                    .clickable(onClick = onConfirm)
                    .padding(horizontal = PersonalSpace.s16, vertical = PersonalSpace.s8),
            )
        },
        dismissButton = {
            Text(
                "Keep",
                color = theme.palette.textPrimary,
                fontFamily = theme.fontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(PersonalRadius.pill))
                    .clickable(onClick = onDismiss)
                    .padding(horizontal = PersonalSpace.s16, vertical = PersonalSpace.s8),
            )
        },
        containerColor = theme.palette.surface,
    )
}


@Composable
private fun CategorySheet(
    categories: List<CategoryChoice>,
    chosen: CategoryChoice?,
    onChooseCategory: (CategoryChoice) -> Unit,
    onChooseSubcategory: (CategoryChoice, FilterChoice) -> Unit,
    onBack: () -> Unit,
    onDismiss: () -> Unit,
) {
    val theme = LocalPersonalTheme.current
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
                .verticalScroll(rememberScrollState())
                .padding(PersonalSpace.s20),
            verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
        ) {
            Text(
                chosen?.name ?: "Category",
                color = theme.palette.textPrimary,
                fontFamily = theme.fontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
            )
            if (chosen != null) {
                LedgerChip("Categories", false, onBack)
                chosen.subcategories.forEach { sub ->
                    LedgerChip(sub.name, false) { onChooseSubcategory(chosen, sub) }
                }
            } else {
                categories.forEach { category ->
                    LedgerChip(category.name, false) { onChooseCategory(category) }
                }
            }
        }
    }
}

@Composable
private fun Fact(label: String, value: String, enabled: Boolean = true, onClick: (() -> Unit)? = null) {
    val theme = LocalPersonalTheme.current
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(enabled = enabled, onClick = onClick) else Modifier)
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

/** A booked amount in its own currency, never in an assumed one. */
private fun statementMoney(currency: String?, amount: String?, store: UiSessionStore? = null): String {
    val code = store?.displayCurrency(currency) ?: Money.currency(currency)
    return Money.format(
        raw = amount,
        currency = code,
        locale = store?.preferences?.moneyLocale ?: Locale.getDefault(),
        minorUnits = store?.minorUnits(code),
    )
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

private suspend fun saveTransaction(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    id: String,
    correction: TransactionCorrection,
): Boolean {
    val body = JSONObject().apply {
        correction.versionId?.let { put("expected_version_id", it) }
        correction.amount?.let { put("amount", it) }
        correction.direction?.let { put("direction", it) }
        correction.occurredAt?.let { put("occurred_at", it) }
        correction.description?.let { put("description", it) }
        correction.categoryCode?.let { put("category_id", it) }
        correction.subcategoryCode?.let { put("subcategory_id", it) }
        correction.weightCode?.let { put("weight_code", it) }
    }.toString()
    val result = api.submit("PATCH", "/v1/transactions/$id", body, java.util.UUID.randomUUID().toString(), token)
    return result.status in 200..299
}

private suspend fun deleteTransaction(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    id: String,
): Boolean {
    val result = api.submit("DELETE", "/v1/transactions/$id", null, java.util.UUID.randomUUID().toString(), token)
    return result.status in 200..299
}

private fun insightsPath(from: String?, to: String?): String = buildString {
    append("/v1/ledger/insights")
    val params = buildList {
        if (from != null) add("from=$from")
        if (to != null) add("to=$to")
    }
    if (params.isNotEmpty()) append("?").append(params.joinToString("&"))
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
                        versionId = row.optionalText("canonicalTransactionVersionId"),
                        amount = row.optionalText("amount"),
                        currency = row.optionalText("currency"),
                        direction = row.optionalText("direction"),
                        transactionDate = row.optionalText("transactionDate"),
                        description = row.optionalText("description"),
                        categoryCode = row.optionalText("categoryCode"),
                        categoryName = row.optionalText("categoryName"),
                        subcategoryCode = row.optionalText("subcategoryCode"),
                        subcategoryName = row.optionalText("subcategoryName"),
                        accountName = row.optionalText("accountName"),
                        weightCode = row.optionalText("weightCode"),
                        weightName = row.optionalText("weightName"),
                        reference = row.optionalText("reference"),
                        statedAmount = row.optJSONObject("stated")?.optionalText("amount"),
                        statedCurrency = row.optJSONObject("stated")?.optionalText("currency"),
                        currencyBasis = row.optionalText("currencyBasis"),
                        currencyConfidence = if (row.has("currencyConfidence") && !row.isNull("currencyConfidence")) {
                            row.optDouble("currencyConfidence")
                        } else {
                            null
                        },
                        currencyUncertain = row.optBoolean("currencyUncertain", false),
                    ),
                )
            }
        }
    }
    val cursor = if (root.isNull("nextCursor")) null else root.optString("nextCursor").ifBlank { null }
    return LedgerPage(items, cursor, true)
}

private data class LedgerFilters(val categories: List<CategoryChoice>, val weights: List<FilterChoice>)

private fun parseFilters(json: String?): LedgerFilters {
    if (json.isNullOrBlank()) return LedgerFilters(emptyList(), emptyList())
    val root = runCatching { JSONObject(json) }.getOrNull() ?: return LedgerFilters(emptyList(), emptyList())
    val rows = root.optJSONArray("categories")
    val categories = buildList {
        if (rows != null) {
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
    val weightRows = root.optJSONArray("weights")
    val weights = buildList {
        if (weightRows != null) {
            for (index in 0 until weightRows.length()) {
                val row = weightRows.optJSONObject(index) ?: continue
                val code = row.optString("code")
                if (code.isNotBlank()) add(FilterChoice(code, row.optString("name").ifBlank { code }))
            }
        }
    }
    return LedgerFilters(categories, weights)
}
