package com.monytix.app.live

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import com.monytix.app.auth.MonytixApi
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
@Composable
fun LiveDetail(
    page: LivePage,
    store: UiSessionStore,
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    onBack: () -> Unit,
    onAskMoly: () -> Unit,
) {
    val snapshot = remember(store.liveJson) {
        val json = store.liveJson
        if (json.isNullOrBlank()) LiveSnapshot.unavailable() else LiveSnapshot.parse(json)
    }
    LaunchedEffect(Unit) {
        store.refreshLive()
    }
    if (page == LivePage.Transactions) {
        TransactionScreen(api, token, onBack)
        return
    }
    val theme = LocalPersonalTheme.current
    val copy = when (page) {
        LivePage.ForYou -> "For you" to "What changed"
        LivePage.Pulse -> "Financial Pulse" to "Where you stand"
        LivePage.CashFlow -> "Cash flow" to "What’s ahead"
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
            LivePage.ForYou -> ForYou(snapshot)
            LivePage.Pulse -> PulseDetail(snapshot, onAskMoly)
            LivePage.CashFlow -> CashDetail(snapshot, onAskMoly)
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
private fun ForYou(snapshot: LiveSnapshot) {
    val theme = LocalPersonalTheme.current
    if (snapshot.previews.isEmpty()) {
        Text("Nothing has been recorded yet.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    } else {
        snapshot.previews.forEach { row ->
            PlainCard {
                Text(row.description ?: "Recorded movement", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(movementLine(row), color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
                row.accountName?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp) }
            }
        }
    }
}

@Composable
private fun PulseDetail(snapshot: LiveSnapshot, onAskMoly: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Text("The 10 weights", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    weights.chunked(2).forEach { row ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
            row.forEach { name ->
                val amount = snapshot.weights.firstOrNull { it.name == name }?.amount
                PlainCard(Modifier.weight(1f)) {
                    Text(name, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text(amount ?: "No movements this month.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                }
            }
        }
    }
    DetailButton("Ask Moly") { onAskMoly() }
}

@Composable
private fun CashDetail(snapshot: LiveSnapshot, onAskMoly: () -> Unit) {
    val theme = LocalPersonalTheme.current
    GradientCard(listOf(theme.palette.widgetCashStart, theme.palette.widgetCashEnd), theme.palette.widgetCashBorder) {
        val recorded = snapshot.currencies.firstOrNull()
        if (snapshot.recordedFlowAvailable && recorded != null) {
            Text("${recorded.currency} in ${recorded.inflow} · out ${recorded.outflow}", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text("Recorded inflow ${recorded.currency} ${recorded.inflow}", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            Text("Recorded outflow ${recorded.currency} ${recorded.outflow}", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        } else if (snapshot.availableBalance == null) {
            Text("Nothing has been recorded this month.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        }
        if (snapshot.availableBalance != null) {
            Text("Available balance  ${snapshot.availableBalance}", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
    }
    Text("Recorded", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    if (snapshot.previews.isEmpty()) {
        Text("Nothing has been recorded yet.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    } else {
        snapshot.previews.forEach { row ->
            PlainCard {
                Text(row.description ?: "Recorded movement", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(movementLine(row), color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
            }
        }
    }
    Text("Nothing further is scheduled.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    DetailButton("Ask Moly") { onAskMoly() }
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
