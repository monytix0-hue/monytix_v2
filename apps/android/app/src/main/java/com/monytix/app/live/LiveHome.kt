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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.TrendingUp
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Canvas
import com.monytix.app.auth.MonytixApi
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace
import com.monytix.app.theme.PersonalTheme
import kotlinx.coroutines.delay

private const val Unavailable = "Unavailable"

@Composable
fun LiveHome(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    onOpen: (LivePage) -> Unit,
    onViewMissions: () -> Unit,
    onViewDecisions: () -> Unit,
    onViewMile: () -> Unit,
) {
    var snapshot by remember { mutableStateOf(LiveSnapshot.unavailable()) }
    LaunchedEffect(api) {
        val json = api.getJson("/v1/ui/live", token)
        snapshot = if (json.isNullOrBlank()) LiveSnapshot.unavailable() else LiveSnapshot.parse(json)
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
            Icon(Icons.Outlined.ReceiptLong, contentDescription = null, tint = theme.palette.textPrimary, modifier = Modifier.size(24.dp))
            Text("Transactions", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                StatusPill(transactionFact(snapshot))
            }
            Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = theme.palette.textSecondary, modifier = Modifier.size(20.dp))
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
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(PersonalRadius.inset))
                .background(theme.palette.mission)
                .padding(PersonalSpace.s16),
            verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
        ) {
            Text(snapshot.activeMission?.title ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text(snapshot.activeMission?.line ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            Text(snapshot.activeMission?.progress ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
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
            DecisionTile(Modifier.weight(1f), "Strengthen your emergency cushion")
            DecisionTile(Modifier.weight(1f), "Review recurring spending")
        }
        GoldButton("View Decisions  →", onViewDecisions)
    }
}

@Composable
private fun Attention(onOpen: (LivePage) -> Unit) {
    val theme = LocalPersonalTheme.current
    PlainCard(theme.palette.widgetChange, theme.palette.widgetChangeBorder) {
        CardHeading("FOR YOU")
        InsightRow(Icons.Outlined.TrendingUp, "Spending pace")
        InsightRow(Icons.Outlined.Shield, "Emergency buffer")
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
            Text(Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
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
            WeightTile(Modifier.weight(1f), Icons.Outlined.Layers, "Obligations")
            WeightTile(Modifier.weight(1f), Icons.Outlined.TrendingUp, "Opportunity")
            WeightTile(Modifier.weight(1f), Icons.Outlined.Shield, "Resilience")
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
        Canvas(Modifier.size(84.dp)) {
            drawArc(
                color = theme.palette.progressTrack,
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                style = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round),
            )
        }
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
private fun DecisionTile(modifier: Modifier, title: String) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier
            .clip(RoundedCornerShape(PersonalRadius.inset))
            .background(theme.palette.surfaceRaised)
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
    ) {
        Text(title, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    }
}

@Composable
private fun InsightRow(icon: ImageVector, title: String) {
    val theme = LocalPersonalTheme.current
    Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = theme.palette.textPrimary, modifier = Modifier.size(22.dp))
        Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s4)) {
            Text(title, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
    }
}

@Composable
private fun WeightTile(modifier: Modifier, icon: ImageVector, title: String) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier
            .clip(RoundedCornerShape(PersonalRadius.inset))
            .background(theme.palette.surfaceRaised)
            .padding(PersonalSpace.s12),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
    ) {
        Icon(icon, contentDescription = null, tint = theme.palette.textPrimary, modifier = Modifier.size(20.dp))
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

private fun transactionFact(snapshot: LiveSnapshot): String {
    if (!snapshot.transactionsKnown) {
        return Unavailable
    }
    return if (snapshot.hasRecordedTransactions) "Recorded" else "No recorded transactions"
}
