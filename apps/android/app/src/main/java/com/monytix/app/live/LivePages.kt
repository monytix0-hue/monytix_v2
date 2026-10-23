package com.monytix.app.live

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import com.monytix.app.R
import com.monytix.app.theme.FigIcon
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.shell.UiSessionStore
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace

enum class LivePage { Home, ForYou, Pulse, CashFlow, Transactions, Moly }

private const val Unavailable = "Unavailable"
private val weights = listOf(
    "Obligations", "Opportunity", "Resilience", "Comfort", "Risk",
    "Time", "Relationships", "Identity", "Attention", "Legacy",
)
private val questions = listOf(
    "Why did my Obligations increase?",
    "Why is this considered flexible?",
    "What changed since my last visit?",
    "Which transactions affected my Comfort Weight?",
    "What should I understand about my Emergency Buffer?",
)
private val filters = listOf("All", "Spending", "Income", "Transfers")

@Composable
fun LiveDetail(
    page: LivePage,
    store: UiSessionStore,
    onBack: () -> Unit,
    onAskMoly: () -> Unit,
) {
    val snapshot = remember(store.liveJson) {
        val json = store.liveJson
        if (json.isNullOrBlank()) LiveSnapshot.unavailable() else LiveSnapshot.parse(json)
    }
    LaunchedEffect(store) {
        if (!store.liveReady) store.refreshLive()
    }
    val theme = LocalPersonalTheme.current
    val copy = when (page) {
        LivePage.ForYou -> "For you" to "What changed"
        LivePage.Pulse -> "Financial Pulse" to "Where you stand"
        LivePage.CashFlow -> "Cash flow" to "What’s ahead"
        LivePage.Transactions -> "Transactions" to "Recorded activity"
        else -> "Moly" to "Ask about your money"
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.canvas)
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = PersonalSpace.s20)
            .padding(top = PersonalSpace.s16, bottom = PersonalSpace.s32),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s20),
    ) {
        BackBar(copy.first, copy.second, onBack)
        when (page) {
            LivePage.ForYou -> ForYou()
            LivePage.Pulse -> PulseDetail(onAskMoly)
            LivePage.CashFlow -> CashDetail(snapshot, onAskMoly)
            LivePage.Transactions -> TransactionsDetail(snapshot)
            else -> MolyDetail()
        }
    }
}

@Composable
private fun BackBar(title: String, subtitle: String, onBack: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
        Box(
            modifier = Modifier
                .size(40.dp)
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
private fun ForYou() {
    val theme = LocalPersonalTheme.current
    SummaryCard("This period", Unavailable)
    repeat(2) {
        PlainCard {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                StatusPill(Unavailable)
            }
            Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            DetailButton(Unavailable) {}
        }
    }
    PlainCard {
        Text("Holding steady", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
}

@Composable
private fun PulseDetail(onAskMoly: () -> Unit) {
    val theme = LocalPersonalTheme.current
    GradientCard(listOf(theme.palette.widgetWeight, theme.palette.surface), theme.palette.widgetWeightBorder) {
        Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s16), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(56.dp).clip(CircleShape).background(theme.palette.surface).border(1.dp, theme.palette.border, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                FigIcon(R.drawable.fig_activity, 36.dp)
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            }
        }
        CountPills()
    }
    Text("The 10 weights", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    weights.chunked(2).forEach { row ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
            row.forEach { name ->
                PlainCard(Modifier.weight(1f)) {
                    Text(name, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                }
            }
        }
    }
    PlainCard {
        Text("About these weights", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
    DetailButton("Ask Moly") { onAskMoly() }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CountPills() {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8), verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
        repeat(3) { StatusPill(Unavailable) }
    }
}

@Composable
private fun CashDetail(snapshot: LiveSnapshot, onAskMoly: () -> Unit) {
    val theme = LocalPersonalTheme.current
    GradientCard(listOf(theme.palette.widgetCashStart, theme.palette.widgetCashEnd), theme.palette.widgetCashBorder) {
        Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        Text("flexible", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(PersonalRadius.pill)).background(theme.palette.progressTrack))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Available  $Unavailable", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            Text("Committed  $Unavailable", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
        if (snapshot.availableBalance != null) {
            Text("Available balance  ${snapshot.availableBalance}", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
        if (snapshot.recordedFlowAvailable) {
            snapshot.currencies.forEach { row ->
                Text("Recorded inflow  ${row.inflow} ${row.currency}", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                Text("Recorded outflow  ${row.outflow} ${row.currency}", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            }
        }
    }
    Text("What’s coming", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    listOf(
        R.drawable.fig_cash_wallet,
        R.drawable.fig_cash_landmark,
        R.drawable.fig_cash_receipt,
        R.drawable.fig_cash_arrow,
        R.drawable.fig_cash_flag,
    ).forEach { icon ->
        PlainCard {
            Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12), verticalAlignment = Alignment.CenterVertically) {
                FigIcon(icon, 28.dp)
                Column {
                    Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
                }
            }
        }
    }
    PlainCard {
        Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12), verticalAlignment = Alignment.CenterVertically) {
            FigIcon(R.drawable.fig_cash_check, 24.dp)
            Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    }
    DetailButton("Ask Moly") { onAskMoly() }
}

@Composable
private fun TransactionsDetail(snapshot: LiveSnapshot) {
    val summary = when {
        !snapshot.transactionsKnown -> Unavailable
        snapshot.hasRecordedTransactions -> "Recorded"
        else -> "No recorded transactions"
    }
    SummaryCard("Recorded activity", summary)
    var selected by remember { mutableStateOf(filters.first()) }
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
        filters.forEach { name ->
            val on = name == selected
            val theme = LocalPersonalTheme.current
            Text(
                name,
                color = if (on) theme.action.label else theme.palette.textSecondary,
                fontFamily = theme.fontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(PersonalRadius.pill))
                    .background(if (on) theme.action.default else theme.palette.surface)
                    .border(1.dp, if (on) theme.action.default else theme.palette.border, RoundedCornerShape(PersonalRadius.pill))
                    .clickable { selected = name }
                    .padding(horizontal = PersonalSpace.s16, vertical = PersonalSpace.s12),
            )
        }
    }
    val shown = when (selected) {
        "Income" -> snapshot.previews.filter { it.direction == "IN" }
        "Spending" -> snapshot.previews.filter { it.direction == "OUT" }
        "Transfers" -> emptyList()
        else -> snapshot.previews
    }
    if (snapshot.previewsKnown && shown.isNotEmpty()) {
        shown.forEach { row ->
            PlainCard {
                val theme = LocalPersonalTheme.current
                val money = formatLiveMoney(row.currency, row.amount)
                val mark = when (row.direction) {
                    "IN" -> R.drawable.fig_cash_arrow
                    "OUT" -> R.drawable.fig_utensils
                    else -> R.drawable.fig_tx_user
                }
                Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12), verticalAlignment = Alignment.CenterVertically) {
                    FigIcon(mark, 28.dp)
                    Column {
                        Text(row.description ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(money, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
                        Text(row.transactionDate ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                    }
                }
            }
        }
    } else {
        PlainCard {
            val theme = LocalPersonalTheme.current
            Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        }
    }
}

@Composable
private fun MolyDetail() {
    val theme = LocalPersonalTheme.current
    SummaryCard("Right now", Unavailable)
    Text("You could ask", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    questions.forEach { question ->
        PlainCard {
            Text(question, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        }
    }
    Text(
        "Ask Moly",
        color = theme.palette.textSecondary,
        fontFamily = theme.fontFamily,
        fontSize = 15.sp,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.action))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.action))
            .padding(horizontal = PersonalSpace.s16, vertical = PersonalSpace.s16),
    )
}

@Composable
private fun SummaryCard(label: String, value: String) {
    val theme = LocalPersonalTheme.current
    PlainCard {
        Text(label, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        Text(value, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    }
}

@Composable
private fun DetailButton(label: String, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(PersonalRadius.action))
            .background(theme.action.default)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = theme.action.label, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

@Composable
private fun StatusPill(label: String) {
    val theme = LocalPersonalTheme.current
    Text(
        text = label,
        modifier = Modifier
            .clip(CircleShape)
            .background(if (theme.isDark) theme.palette.surfaceRaised else theme.status.lavender)
            .padding(horizontal = PersonalSpace.s12, vertical = PersonalSpace.s8),
        color = if (theme.isDark) theme.palette.popoverBorder else theme.palette.textPrimary,
        fontFamily = theme.fontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 12.sp,
    )
}

@Composable
private fun GradientCard(colors: List<Color>, border: Color, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(Brush.verticalGradient(colors))
            .border(1.dp, border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
        content = content,
    )
}

@Composable
private fun PlainCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
        content = content,
    )
}

private fun formatLiveMoney(currency: String?, amount: String?): String {
    if (currency.isNullOrBlank() || amount.isNullOrBlank()) {
        return Unavailable
    }
    val value = amount.replace(",", "").toDoubleOrNull()
    val formatted = if (value != null) {
        String.format(java.util.Locale.US, "%,.2f", value)
    } else {
        amount
    }
    return "$currency $formatted"
}
