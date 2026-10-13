package com.monytix.app.theme

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Image
import com.monytix.app.R

@Composable
fun ThemeKitScreen() {
    val theme = LocalPersonalTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.canvas)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(PersonalSpace.s20),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s32),
    ) {
        Header()
        Section(
            title = "01 / Everyday widgets",
            body = "One pattern per role. Reuse the card surface, hierarchy and action slot across the app.",
        ) {
            GoalCard()
            DecisionCard()
            ChangeCard()
            CashCard()
            WeightCard()
            ImpactCard()
        }
        Section(
            title = "02 / Status with a little lift",
            body = "Gold, mint, coral, and lavender name a meaning. They are not decoration.",
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
                StatusPill("Gold", PersonalStatusTone.Gold)
                StatusPill("Mint", PersonalStatusTone.Mint)
                StatusPill("Coral", PersonalStatusTone.Coral)
                StatusPill("Lavender", PersonalStatusTone.Lavender)
            }
        }
        Section(
            title = "03 / One action. Four appearances.",
            body = "Gold is the primary next step. Keep the copy, dimensions and corner shape unchanged across states.",
        ) {
            ActionButton("See the transactions  →", PersonalActionState.Default)
            ActionButton("See the transactions  →", PersonalActionState.Hover)
            ActionButton("See the transactions  →", PersonalActionState.Pressed)
            ActionButton("See the transactions  →", PersonalActionState.Disabled)
        }
        Section(
            title = "04 / Context first. Details when needed.",
            body = "Use a popover for a short explanation. Use a sheet when the action needs more context.",
        ) {
            PopoverExample()
            SheetExample()
        }
        BrandAssets()
    }
}

@Composable
private fun Header() {
    val theme = LocalPersonalTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ThemedText(
                if (theme.isDark) "MONYTIX / DARK" else "MONYTIX / LIGHT",
                size = PersonalTypeScale.bodyLarge,
                weight = FontWeight.ExtraBold,
                color = theme.palette.accent,
            )
            ThemedText(
                if (theme.isDark) "DARK MODE" else "LIGHT MODE",
                size = PersonalTypeScale.footnote,
                color = theme.palette.textSecondary,
            )
        }
        ThemedText(
            "Familiar everywhere. Clear at every step.",
            size = PersonalTypeScale.hero,
            weight = FontWeight.ExtraBold,
            color = theme.palette.textPrimary,
        )
        ThemedText(
            "Reusable patterns for your money, right now. Soft role colors, elevated status pills and a warm gold action hierarchy.",
            size = PersonalTypeScale.bodyLarge,
            color = theme.palette.textSecondary,
        )
    }
}

@Composable
private fun Section(title: String, body: String, content: @Composable () -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s16)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(theme.palette.divider),
        )
        ThemedText(title, size = PersonalTypeScale.headline, weight = FontWeight.ExtraBold, color = theme.palette.textPrimary)
        ThemedText(body, size = PersonalTypeScale.bodySmall, color = theme.palette.textSecondary)
        content()
    }
}

@Composable
private fun GoalCard() {
    val theme = LocalPersonalTheme.current
    WidgetSurface(
        colors = listOf(theme.palette.widgetGoalStart, theme.palette.widgetGoalMid, theme.palette.widgetGoalEnd),
        border = theme.palette.widgetGoalBorder,
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("MISSIONS")
            StatusPill("2 ACTIVE", PersonalStatusTone.Lavender)
        }
        Box(modifier = Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) {
            Canvas(modifier = Modifier.size(140.dp)) {
                drawArc(
                    color = theme.palette.border,
                    startAngle = 0f,
                    sweepAngle = 360f,
                    useCenter = false,
                    style = Stroke(width = 10.dp.toPx(), cap = StrokeCap.Round),
                )
                drawArc(
                    color = theme.palette.accent,
                    startAngle = -90f,
                    sweepAngle = 133f,
                    useCenter = false,
                    style = Stroke(width = 10.dp.toPx(), cap = StrokeCap.Round),
                )
            }
            ThemedText("37%", size = PersonalTypeScale.hero, weight = FontWeight.ExtraBold, color = theme.palette.textPrimary)
        }
        ThemedText("Home Fund", size = PersonalTypeScale.title, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        ThemedText("₹1.84L / ₹5L", size = PersonalTypeScale.bodyLarge, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        ThemedText("₹12K this month", size = PersonalTypeScale.footnote, color = theme.palette.textSecondary)
        ActionButton("View Missions  →", PersonalActionState.Default)
    }
}

@Composable
private fun DecisionCard() {
    val theme = LocalPersonalTheme.current
    WidgetSurface(color = theme.palette.widgetDecision, border = theme.palette.widgetDecisionBorder) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("DECISIONS")
            StatusPill("2 NEED YOU", PersonalStatusTone.Coral)
        }
        ThemedText("Strengthen your emergency cushion", size = PersonalTypeScale.headline, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        ThemedText("Your buffer has reduced.", size = PersonalTypeScale.body, color = theme.palette.textSecondary)
        ActionButton("View Decisions  →", PersonalActionState.Default)
    }
}

@Composable
private fun ChangeCard() {
    val theme = LocalPersonalTheme.current
    WidgetSurface(color = theme.palette.widgetChange, border = theme.palette.widgetChangeBorder) {
        Eyebrow("FOR YOU")
        ThemedText("Two things are worth a look", size = PersonalTypeScale.headline, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        ThemedText("Spending pace increased this week", size = PersonalTypeScale.bodyLarge, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        ThemedText("Lifestyle spending is ₹4,800 above your usual pace.", size = PersonalTypeScale.body, color = theme.palette.textSecondary)
        Box(Modifier.fillMaxWidth().height(1.dp).background(theme.palette.divider))
        ThemedText("Emergency Buffer is slightly behind", size = PersonalTypeScale.bodyLarge, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        ThemedText("Progress is ₹6,200 below this month\u2019s expected pace.", size = PersonalTypeScale.body, color = theme.palette.textSecondary)
        ActionButton("See what changed  →", PersonalActionState.Default)
    }
}

@Composable
private fun CashCard() {
    val theme = LocalPersonalTheme.current
    WidgetSurface(
        colors = listOf(theme.palette.widgetCashStart, theme.palette.widgetCashEnd),
        border = theme.palette.widgetCashBorder,
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("CASH FLOW")
            StatusPill("14 DAYS", PersonalStatusTone.Mint)
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
            ThemedText("₹41,400", size = PersonalTypeScale.hero, weight = FontWeight.ExtraBold, color = theme.palette.textPrimary)
            ThemedText("flexible", size = PersonalTypeScale.bodyLarge, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(PersonalSpace.s12)
                .clip(RoundedCornerShape(PersonalRadius.pill)),
        ) {
            Box(Modifier.weight(0.7f).fillMaxHeight().background(theme.palette.cashFlexible))
            Box(Modifier.weight(0.3f).fillMaxHeight().background(theme.palette.cashCommitted))
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            ThemedText("₹72,600 available", size = PersonalTypeScale.footnote, weight = FontWeight.Bold, color = theme.palette.textPrimary)
            ThemedText("₹31,200 committed", size = PersonalTypeScale.footnote, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        }
        StatusPill("COMFORTABLE", PersonalStatusTone.Mint)
        ThemedText("Salary expected in 11 days", size = PersonalTypeScale.body, color = theme.palette.textPrimary)
        ActionButton("See what\u2019s ahead  →", PersonalActionState.Default)
    }
}

@Composable
private fun WeightCard() {
    val theme = LocalPersonalTheme.current
    WidgetSurface(color = theme.palette.widgetWeight, border = theme.palette.widgetWeightBorder) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("FINANCIAL WEIGHT")
            StatusPill("Resilience ↓", PersonalStatusTone.Lavender)
        }
        ThemedText("Resilience ↓", size = PersonalTypeScale.display, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        ThemedText("Your cushion reduced slightly", size = PersonalTypeScale.body, color = theme.palette.textSecondary)
        ActionButton("Explore your 10 Weights  →", PersonalActionState.Default)
    }
}

@Composable
private fun ImpactCard() {
    val theme = LocalPersonalTheme.current
    WidgetSurface(
        colors = listOf(theme.palette.widgetImpactStart, theme.palette.widgetImpactEnd),
        border = theme.palette.widgetImpactBorder,
    ) {
        Eyebrow("M.I.L.E.")
        ThemedText("Money Impact & Life Evolution", size = PersonalTypeScale.footnote, color = theme.palette.textSecondary)
        ThemedText("₹38,400", size = PersonalTypeScale.amount, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        ThemedText("positive financial impact", size = PersonalTypeScale.bodySmall, color = theme.palette.textSecondary)
        Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
            StatusPill("+₹6,200 this month", PersonalStatusTone.Gold)
            StatusPill("Resilience ↑", PersonalStatusTone.Mint)
        }
        ActionButton("See your M.I.L.E.  →", PersonalActionState.Default)
    }
}

@Composable
private fun PopoverExample() {
    val theme = LocalPersonalTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
        ThemedText("Contextual popover", size = PersonalTypeScale.body, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        ThemedText("Button context · Explain a change before opening details", size = PersonalTypeScale.footnote, color = theme.palette.textSecondary)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(PersonalRadius.card))
                .background(theme.palette.anchor)
                .padding(PersonalSpace.s20),
            verticalArrangement = Arrangement.spacedBy(PersonalSpace.s16),
        ) {
            ActionButton("See what changed  →", PersonalActionState.Default)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(theme.elevation.sheet.blur, RoundedCornerShape(PersonalRadius.popover), ambientColor = theme.elevation.sheet.color, spotColor = theme.elevation.sheet.color)
                    .clip(RoundedCornerShape(PersonalRadius.popover))
                    .background(theme.palette.popover)
                    .border(1.dp, theme.palette.popoverBorder, RoundedCornerShape(PersonalRadius.popover))
                    .padding(PersonalSpace.s20),
                verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
            ) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    StatusPill("Comfort ↑", PersonalStatusTone.Gold)
                    CloseButton()
                }
                ThemedText("Spending pace increased", size = PersonalTypeScale.display, weight = FontWeight.Bold, color = theme.palette.textPrimary)
                ThemedText("Lifestyle spending is ₹4,800 above your usual weekly pace.", size = PersonalTypeScale.body, color = theme.palette.textSecondary)
                ActionButton("See the transactions  →", PersonalActionState.Default)
            }
        }
    }
}

@Composable
private fun SheetExample() {
    val theme = LocalPersonalTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
        ThemedText("Action-detail bottom sheet", size = PersonalTypeScale.body, weight = FontWeight.Bold, color = theme.palette.textPrimary)
        ThemedText("Mission context · Review before opening a financial action", size = PersonalTypeScale.footnote, color = theme.palette.textSecondary)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(PersonalRadius.sheet))
                .background(theme.palette.backdrop)
                .padding(top = PersonalSpace.s32),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .shadow(theme.elevation.sheet.blur, RoundedCornerShape(topStart = PersonalRadius.sheet, topEnd = PersonalRadius.sheet), ambientColor = theme.elevation.sheet.color, spotColor = theme.elevation.sheet.color)
                    .clip(RoundedCornerShape(topStart = PersonalRadius.sheet, topEnd = PersonalRadius.sheet))
                    .background(theme.palette.sheet)
                    .border(1.dp, theme.palette.sheetBorder, RoundedCornerShape(topStart = PersonalRadius.sheet, topEnd = PersonalRadius.sheet))
                    .padding(horizontal = PersonalSpace.s24, vertical = PersonalSpace.s12),
                verticalArrangement = Arrangement.spacedBy(PersonalSpace.s16),
            ) {
                Box(Modifier.fillMaxWidth().padding(top = PersonalSpace.s4), contentAlignment = Alignment.Center) {
                    Box(
                        Modifier
                            .width(40.dp)
                            .height(PersonalSpace.s4)
                            .clip(RoundedCornerShape(PersonalRadius.pill))
                            .background(theme.palette.dragHandle),
                    )
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    StatusPill("Resilience ↓", PersonalStatusTone.Lavender)
                    CloseButton()
                }
                ThemedText("Emergency Buffer is behind", size = PersonalTypeScale.display, weight = FontWeight.Bold, color = theme.palette.textPrimary)
                ThemedText("You are ₹6,200 below this month\u2019s expected Mission pace.", size = PersonalTypeScale.body, color = theme.palette.textSecondary)
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(PersonalRadius.inset))
                        .background(theme.palette.mission)
                        .border(1.dp, theme.palette.widgetImpactBorder, RoundedCornerShape(PersonalRadius.inset))
                        .padding(PersonalSpace.s20),
                    verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
                ) {
                    ThemedText("Emergency Buffer", size = PersonalTypeScale.bodyLarge, weight = FontWeight.Bold, color = theme.palette.textPrimary)
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        ThemedText("₹82K / ₹1.5L", size = PersonalTypeScale.title, weight = FontWeight.Bold, color = theme.palette.textPrimary)
                        ThemedText("55%", size = PersonalTypeScale.title, weight = FontWeight.ExtraBold, color = theme.palette.textPrimary)
                    }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(PersonalSpace.s8)
                            .clip(RoundedCornerShape(PersonalRadius.pill))
                            .background(theme.palette.progressTrack),
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth(0.55f)
                                .fillMaxHeight()
                                .background(theme.palette.progressFill),
                        )
                    }
                }
                ActionButton("Open Emergency Buffer  →", PersonalActionState.Default)
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .clip(RoundedCornerShape(PersonalRadius.action))
                        .background(theme.palette.dismiss),
                    contentAlignment = Alignment.Center,
                ) {
                    ThemedText("Dismiss", size = PersonalTypeScale.bodySmall, weight = FontWeight.Bold, color = theme.palette.textPrimary)
                }
                Spacer(Modifier.height(PersonalSpace.s8))
            }
        }
    }
}

@Composable
private fun BrandAssets() {
    val theme = LocalPersonalTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(PersonalSpace.s16)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(theme.palette.divider))
        ThemedText("Logo and icon", size = PersonalTypeScale.headline, weight = FontWeight.ExtraBold, color = theme.palette.textPrimary)
        Image(
            painter = painterResource(R.drawable.monytix_logo),
            contentDescription = "Monytix logo",
            modifier = Modifier.height(48.dp),
            contentScale = ContentScale.Fit,
        )
        Image(
            painter = painterResource(R.drawable.monytix_mark),
            contentDescription = "Monytix icon",
            modifier = Modifier.size(72.dp),
            contentScale = ContentScale.Fit,
        )
    }
}

@Composable
private fun WidgetSurface(
    color: Color? = null,
    colors: List<Color>? = null,
    border: Color,
    content: @Composable () -> Unit,
) {
    val theme = LocalPersonalTheme.current
    val shape = RoundedCornerShape(PersonalRadius.card)
    val brush = when {
        colors != null && colors.distinct().size > 1 -> Brush.horizontalGradient(colors)
        colors != null -> Brush.horizontalGradient(listOf(colors.first(), colors.first()))
        color != null -> Brush.horizontalGradient(listOf(color, color))
        else -> Brush.horizontalGradient(listOf(theme.palette.surface, theme.palette.surface))
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(theme.elevation.card.blur, shape, ambientColor = theme.elevation.card.color, spotColor = theme.elevation.card.color)
            .clip(shape)
            .background(brush)
            .border(1.dp, border, shape)
            .padding(PersonalSpace.s24),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s16),
    ) {
        content()
    }
}

@Composable
private fun ActionButton(label: String, state: PersonalActionState) {
    val theme = LocalPersonalTheme.current
    val fill = when (state) {
        PersonalActionState.Default -> theme.action.default
        PersonalActionState.Hover -> theme.action.hover
        PersonalActionState.Pressed -> theme.action.pressed
        PersonalActionState.Disabled -> theme.action.disabledFill
    }
    val labelColor = if (state == PersonalActionState.Disabled) theme.action.disabledLabel else theme.action.label
    val border = if (state == PersonalActionState.Disabled) theme.palette.border else theme.status.goldBorder
    val shape = RoundedCornerShape(PersonalRadius.action)
    val shadow = if (state == PersonalActionState.Default || state == PersonalActionState.Hover) {
        Modifier.shadow(theme.elevation.action.blur, shape, ambientColor = theme.elevation.action.color, spotColor = theme.elevation.action.color)
    } else {
        Modifier
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .then(shadow)
            .clip(shape)
            .background(fill)
            .border(1.dp, border, shape),
        contentAlignment = Alignment.Center,
    ) {
        ThemedText(label, size = PersonalTypeScale.bodySmall, weight = FontWeight.Bold, color = labelColor)
    }
}

@Composable
private fun StatusPill(label: String, tone: PersonalStatusTone) {
    val theme = LocalPersonalTheme.current
    val shape = RoundedCornerShape(PersonalRadius.pill)
    Box(
        modifier = Modifier
            .shadow(theme.elevation.action.blur, shape, ambientColor = theme.elevation.action.color, spotColor = theme.elevation.action.color)
            .clip(shape)
            .background(theme.status.color(tone))
            .border(1.dp, theme.status.border(tone), shape)
            .padding(horizontal = PersonalSpace.s12, vertical = PersonalSpace.s6),
        contentAlignment = Alignment.Center,
    ) {
        ThemedText(label, size = PersonalTypeScale.caption, weight = FontWeight.Bold, color = theme.palette.textPrimary)
    }
}

@Composable
private fun CloseButton() {
    val theme = LocalPersonalTheme.current
    Box(
        modifier = Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(theme.palette.closeFill)
            .border(1.dp, theme.palette.border, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        ThemedText("×", size = PersonalTypeScale.titleSmall, weight = FontWeight.Bold, color = theme.palette.textPrimary)
    }
}

@Composable
private fun Eyebrow(text: String) {
    val theme = LocalPersonalTheme.current
    ThemedText(text, size = PersonalTypeScale.caption, weight = FontWeight.ExtraBold, color = theme.palette.textPrimary)
}

@Composable
private fun ThemedText(
    text: String,
    size: androidx.compose.ui.unit.TextUnit,
    weight: FontWeight = FontWeight.Normal,
    color: Color,
) {
    val theme = LocalPersonalTheme.current
    Text(
        text = text,
        color = color,
        fontFamily = theme.fontFamily,
        fontWeight = weight,
        fontSize = size,
        lineHeight = size * PersonalTypeScale.bodyLineHeight,
    )
}
