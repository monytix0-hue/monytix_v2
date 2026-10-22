package com.monytix.app.live

import android.provider.Settings
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.R
import com.monytix.app.shell.UiSessionStore
import com.monytix.app.theme.FigIcon
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace
import com.monytix.app.theme.PersonalTheme
import kotlinx.coroutines.delay

private const val Unavailable = "Unavailable"

@Composable
fun LiveHome(
    store: UiSessionStore,
    onOpen: (LivePage) -> Unit,
    onViewMissions: () -> Unit,
    onViewDecisions: () -> Unit,
    onViewMile: () -> Unit,
) {
    val snapshot = remember(store.liveJson) {
        val json = store.liveJson
        if (json.isNullOrBlank()) LiveSnapshot.unavailable() else LiveSnapshot.parse(json)
    }
    LaunchedEffect(store) {
        if (!store.liveReady) store.refreshLive()
    }
    PersonalTheme {
        val theme = LocalPersonalTheme.current
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(theme.palette.canvas)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = PersonalSpace.s28)
                .padding(top = PersonalSpace.s20, bottom = 128.dp),
            verticalArrangement = Arrangement.spacedBy(PersonalSpace.s20),
        ) {
            Enter(0) { Welcome(snapshot, onOpen) }
            Enter(64) { Missions(snapshot, onViewMissions) }
            Enter(128) { Decisions(onViewDecisions) }
            Enter(195) { Attention(onOpen) }
            Enter(260) { Cash(snapshot, onOpen) }
            Enter(325) { Pulse(onOpen) }
            Enter(390) { Mile(onViewMile) }
        }
    }
}

@Composable
private fun Welcome(snapshot: LiveSnapshot, onOpen: (LivePage) -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s20)) {
        Text(
            text = "Your money, right now",
            color = theme.palette.textPrimary,
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 26.sp,
            lineHeight = 26.sp * 1.4f,
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(PersonalRadius.action))
                .background(if (theme.isDark) theme.palette.surface else theme.status.lavender)
                .border(1.dp, if (theme.isDark) theme.palette.border else theme.status.lavenderBorder, RoundedCornerShape(PersonalRadius.action))
                .clickable { onOpen(LivePage.Transactions) }
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
        ) {
            FigIcon(R.drawable.fig_receipt, 24.dp)
            Text("Transactions", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                StatusPill(transactionFact(snapshot))
            }
            FigIcon(R.drawable.fig_chevron, 20.dp)
        }
        snapshot.previews.take(8).forEach { row ->
            val money = formatMoney(row.currency, row.amount)
            Row(
                horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FigIcon(
                    if (row.direction == "IN") R.drawable.fig_cash_arrow else R.drawable.fig_tx_user,
                    24.dp,
                )
                Column {
                    Text(
                        row.description ?: Unavailable,
                        color = theme.palette.textPrimary,
                        fontFamily = theme.fontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        maxLines = 2,
                    )
                    Text(
                        "$money · ${row.transactionDate ?: Unavailable}",
                        color = theme.palette.textSecondary,
                        fontFamily = theme.fontFamily,
                        fontSize = 13.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun Missions(snapshot: LiveSnapshot, onViewMissions: () -> Unit) {
    val theme = LocalPersonalTheme.current
    GoalCard {
        CardHeading("MISSIONS")
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            ProgressRing(snapshot.activeMission?.progress ?: Unavailable)
            Text(snapshot.activeMission?.line ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
            Text(
                Unavailable,
                modifier = Modifier.padding(top = PersonalSpace.s8),
                color = theme.palette.textSecondary,
                fontFamily = theme.fontFamily,
                fontSize = 13.sp,
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(PersonalRadius.inset))
                .background(theme.palette.mission)
                .padding(PersonalSpace.s16),
            horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FigIcon(R.drawable.fig_orbit_halo_sm, 36.dp)
            Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
            Text(snapshot.activeMission?.title ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text(snapshot.activeMission?.line ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            Text(snapshot.activeMission?.progress ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            }
        }
        GoldButton("View Missions  →", onViewMissions)
    }
}

@Composable
private fun Decisions(onViewDecisions: () -> Unit) {
    val theme = LocalPersonalTheme.current
    PlainCard(theme.palette.widgetDecision, theme.palette.widgetDecisionBorder) {
        CardHeading("DECISIONS")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
            DecisionTile(Modifier.weight(1f), R.drawable.fig_biz_shield, "Strengthen your emergency cushion")
            DecisionTile(Modifier.weight(1f), R.drawable.fig_biz_shield_2, "Review recurring spending")
        }
        GoldButton("View Decisions  →", onViewDecisions)
    }
}

@Composable
private fun Attention(onOpen: (LivePage) -> Unit) {
    val theme = LocalPersonalTheme.current
    PlainCard(theme.palette.widgetChange, theme.palette.widgetChangeBorder) {
        CardHeading("FOR YOU")
        InsightRow(R.drawable.fig_trending_up, "Spending pace")
        InsightRow(R.drawable.fig_shield_alert, "Emergency buffer")
        GoldButton("See what changed  →") { onOpen(LivePage.ForYou) }
    }
}

@Composable
private fun Cash(snapshot: LiveSnapshot, onOpen: (LivePage) -> Unit) {
    val theme = LocalPersonalTheme.current
    GradientCard(
        listOf(theme.palette.widgetCashStart, theme.palette.widgetCashEnd),
        theme.palette.widgetCashBorder,
    ) {
        CardHeading("CASH FLOW")
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
            Text(cashHeadline(snapshot), color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text(
                "flexible",
                color = theme.palette.textSecondary,
                fontFamily = theme.fontFamily,
                fontSize = 16.sp,
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(12.dp)
                .clip(CircleShape)
                .background(theme.palette.progressTrack),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        }
        StatusPill()
        Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        if (snapshot.availableBalance != null) {
            Text("Available balance", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            Text(snapshot.availableBalance, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        }
        if (snapshot.recordedFlowAvailable) {
            snapshot.currencies.forEach { row ->
                Text("Recorded inflow", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                Text("${row.currency} ${row.inflow}", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                Text("Recorded outflow", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                Text("${row.currency} ${row.outflow}", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            }
        }
        GoldButton("See what’s ahead  →") { onOpen(LivePage.CashFlow) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Pulse(onOpen: (LivePage) -> Unit) {
    val theme = LocalPersonalTheme.current
    PlainCard(theme.palette.widgetWeight, theme.palette.widgetWeightBorder) {
        CardHeading("FINANCIAL PULSE")
        Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8), verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
            repeat(3) { StatusPill() }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
            WeightTile(Modifier.weight(1f), R.drawable.fig_activity, "Obligations")
            WeightTile(Modifier.weight(1f), R.drawable.fig_sprout, "Opportunity")
            WeightTile(Modifier.weight(1f), R.drawable.fig_shield, "Resilience")
        }
        GoldButton("Explore your 10 Weights  →") { onOpen(LivePage.Pulse) }
    }
}

@Composable
private fun Mile(onViewMile: () -> Unit) {
    val theme = LocalPersonalTheme.current
    GradientCard(
        listOf(theme.palette.widgetImpactStart, theme.palette.widgetImpactEnd),
        theme.palette.widgetImpactBorder,
    ) {
        Text(
            "M.I.L.E.",
            color = eyebrowColor(),
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.ExtraBold,
            fontSize = 13.sp,
        )
        Text("Money Impact & Life Evolution", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        Text("positive financial impact", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
            StatusPill()
            StatusPill()
        }
        GoldButton("See your M.I.L.E.  →", onViewMile)
    }
}

@Composable
private fun eyebrowColor() = with(LocalPersonalTheme.current) {
    if (isDark) palette.popoverBorder else palette.textPrimary
}

@Composable
private fun CardHeading(title: String) {
    val theme = LocalPersonalTheme.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = eyebrowColor(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
        StatusPill()
    }
}

@Composable
private fun StatusPill(label: String = Unavailable) {
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
private fun GoalCard(content: @Composable () -> Unit) {
    val theme = LocalPersonalTheme.current
    GradientCard(
        listOf(theme.palette.widgetGoalStart, theme.palette.widgetGoalMid, theme.palette.widgetGoalEnd),
        theme.palette.widgetGoalBorder,
        content,
    )
}

@Composable
private fun GradientCard(colors: List<androidx.compose.ui.graphics.Color>, border: androidx.compose.ui.graphics.Color, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(Brush.verticalGradient(colors))
            .border(1.dp, border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
    ) {
        content()
    }
}

@Composable
private fun PlainCard(fill: androidx.compose.ui.graphics.Color, border: androidx.compose.ui.graphics.Color, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(fill)
            .border(1.dp, border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
    ) {
        content()
    }
}

@Composable
private fun ProgressRing(label: String = Unavailable) {
    val theme = LocalPersonalTheme.current
    Box(Modifier.size(96.dp), contentAlignment = Alignment.Center) {
        FigIcon(R.drawable.fig_orbit_halo, 96.dp)
        FigIcon(R.drawable.fig_orbit_track, 84.dp)
        FigIcon(R.drawable.fig_goal_fill, 72.dp)
        FigIcon(R.drawable.fig_progress_origin, 10.dp, Modifier.offset(y = 36.dp))
        FigIcon(R.drawable.fig_progress_marker, 14.dp, Modifier.offset(x = 24.dp, y = (-22).dp))
        Text(
            label,
            color = theme.palette.textPrimary,
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun DecisionTile(modifier: Modifier, icon: Int, title: String) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier
            .clip(RoundedCornerShape(PersonalRadius.inset))
            .background(theme.palette.surfaceRaised)
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
    ) {
        FigIcon(icon, 28.dp)
        Text(title, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    }
}

@Composable
private fun InsightRow(icon: Int, title: String) {
    val theme = LocalPersonalTheme.current
    Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12), verticalAlignment = Alignment.CenterVertically) {
        FigIcon(icon, 28.dp)
        Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s4)) {
            Text(title, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
    }
}

@Composable
private fun WeightTile(modifier: Modifier, icon: Int, title: String) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier
            .clip(RoundedCornerShape(PersonalRadius.inset))
            .background(theme.palette.surfaceRaised)
            .padding(PersonalSpace.s12),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
    ) {
        FigIcon(icon, 22.dp)
        Text(title, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 14.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 12.sp)
    }
}

@Composable
private fun GoldButton(label: String, onClick: () -> Unit = {}) {
    val theme = LocalPersonalTheme.current
    val reduce = animatorScale() == 0f
    val shift = remember { Animatable(0f) }
    LaunchedEffect(reduce) {
        if (reduce) {
            return@LaunchedEffect
        }
        delay(750)
        shift.animateTo(-2f, tween(150, easing = FastOutSlowInEasing))
        shift.animateTo(0f, tween(150, easing = FastOutSlowInEasing))
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .offset(y = shift.value.dp)
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
private fun Enter(delayMillis: Int, content: @Composable () -> Unit) {
    val reduce = animatorScale() == 0f
    var shown by remember { mutableStateOf(reduce) }
    LaunchedEffect(reduce) { shown = true }
    val alpha by animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(420, delayMillis = if (reduce) 0 else delayMillis, easing = FastOutSlowInEasing),
        label = "enter-alpha",
    )
    val offset by animateDpAsState(
        targetValue = if (shown) 0.dp else 8.dp,
        animationSpec = tween(420, delayMillis = if (reduce) 0 else delayMillis, easing = FastOutSlowInEasing),
        label = "enter-offset",
    )
    Box(Modifier.alpha(alpha).offset(y = offset)) { content() }
}

@Composable
private fun animatorScale(): Float {
    val context = LocalContext.current
    return Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
}

private fun cashHeadline(snapshot: LiveSnapshot): String {
    val row = snapshot.currencies.firstOrNull()
    if (!snapshot.recordedFlowAvailable || row == null) {
        return Unavailable
    }
    return "${row.currency} in ${row.inflow} · out ${row.outflow}"
}

private fun transactionFact(snapshot: LiveSnapshot): String {
    if (!snapshot.transactionsKnown) {
        return Unavailable
    }
    return if (snapshot.hasRecordedTransactions) "Recorded" else "No recorded transactions"
}

private fun formatMoney(currency: String?, amount: String?): String {
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
