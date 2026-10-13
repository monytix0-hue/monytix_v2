package com.monytix.app.theme

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import com.monytix.app.R

@Composable
fun BusinessKitScreen(onSignOut: (() -> Unit)? = null) {
    val theme = LocalBusinessTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.canvas)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(BusinessSpace.s20),
        verticalArrangement = Arrangement.spacedBy(BusinessSpace.s28),
    ) {
        Header(onSignOut)
        SectionLabel("Widgets / Operational business overview")
        AttentionCard()
        PulseCard()
        CashCard()
        DecisionsCard()
        MissionsCard()
        ImpactCard()
        DividerLine()
        SectionLabel("Pills / Semantic roles")
        StatusRow()
        SectionLabel("Buttons / Static appearance states")
        ActionButton("View Decisions  →", BusinessActionState.Default)
        ActionButton("View Decisions  →", BusinessActionState.Hover)
        ActionButton("View Decisions  →", BusinessActionState.Pressed)
        ActionButton("View Decisions  →", BusinessActionState.Disabled)
    }
}

@Composable
private fun Header(onSignOut: (() -> Unit)?) {
    val theme = LocalBusinessTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(BusinessSpace.s12)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            KitText("Monytix / Business", BusinessTypeScale.titleSmall, FontWeight.ExtraBold, theme.palette.textPrimary)
            Column(horizontalAlignment = Alignment.End) {
                KitText(if (theme.isDark) "DARK" else "LIGHT", BusinessTypeScale.bodySmall, FontWeight.SemiBold, theme.palette.textSecondary)
                if (onSignOut != null) {
                    Text(
                        text = "Sign out",
                        color = theme.palette.accent,
                        fontFamily = theme.fontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = BusinessTypeScale.bodySmall,
                        modifier = Modifier.clickable(onClick = onSignOut),
                    )
                }
            }
        }
        KitText("Business widgets & controls", BusinessTypeScale.hero, FontWeight.ExtraBold, theme.palette.textPrimary)
        KitText(
            "Six complete widgets. Editable text. Matching semantic roles across themes.",
            BusinessTypeScale.bodyLarge,
            FontWeight.Normal,
            theme.palette.textSecondary,
        )
    }
}

@Composable
private fun AttentionCard() {
    val theme = LocalBusinessTheme.current
    Card(theme.palette.surface) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("FOR YOU")
            StatusPill("2 CHANGES", BusinessStatusTone.Neutral)
        }
        KitText("Two business shifts are worth a look", BusinessTypeScale.headline, FontWeight.Bold, theme.palette.textPrimary)
        SignalRow(R.drawable.business_trending, "Operating costs increased this week", "Operating spend is ₹48,000 above its recent pace.")
        DividerLine()
        SignalRow(R.drawable.business_shield_alert, "Reserve coverage is below target", "Current coverage is 53 days against a 90-day target.")
        ActionButton("See what changed  →", BusinessActionState.Default)
    }
}

@Composable
private fun PulseCard() {
    val theme = LocalBusinessTheme.current
    Card(theme.palette.surface) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("BUSINESS PULSE")
            StatusPill("UPDATED TODAY", BusinessStatusTone.Neutral)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(BusinessSpace.s16)) {
            KitIcon(R.drawable.business_pulse, 60.dp)
            KitText("Stable", BusinessTypeScale.status, FontWeight.ExtraBold, theme.palette.textPrimary)
        }
        KitText(
            "Cash stability is holding, while obligations and customer dependency need attention.",
            BusinessTypeScale.bodyLarge,
            FontWeight.Normal,
            theme.palette.textSecondary,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(BusinessSpace.s8)) {
            StatusPill("2 improving", BusinessStatusTone.Positive)
            StatusPill("4 stable", BusinessStatusTone.Neutral)
            StatusPill("2 watch", BusinessStatusTone.Attention)
        }
        DividerLine()
        DimensionRow(R.drawable.business_dimension_1, "Obligation Pressure ↑", "Supplier and payroll commitments increased", theme.palette.attentionLabel)
        DimensionRow(R.drawable.business_dimension_2, "Protection Adequacy ↑", "Reserve coverage improved", theme.palette.positiveLabel)
        DimensionRow(R.drawable.business_dimension_3, "Dependency Pressure ↑", "Top customer concentration remains high", theme.palette.neutralLabel)
        ActionButton("Explore Business Pulse  →", BusinessActionState.Default)
    }
}

@Composable
private fun CashCard() {
    val theme = LocalBusinessTheme.current
    Card(theme.palette.surfaceRaised) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("CASH FLOW")
            StatusPill("14 DAYS", BusinessStatusTone.Positive)
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(BusinessSpace.s12)) {
            KitText("₹1,50,000", BusinessTypeScale.hero, FontWeight.ExtraBold, theme.palette.textPrimary)
            KitText("net positive", BusinessTypeScale.body, FontWeight.SemiBold, theme.palette.textPrimary)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            KitText("₹8.40L inflow", BusinessTypeScale.bodySmall, FontWeight.SemiBold, theme.palette.textPrimary)
            KitText("₹6.90L outflow", BusinessTypeScale.bodySmall, FontWeight.SemiBold, theme.palette.textPrimary)
        }
        StatusPill("COMFORTABLE", BusinessStatusTone.Positive)
        KitText("Major receivable expected in 8 days", BusinessTypeScale.body, FontWeight.Normal, theme.palette.textPrimary)
        ActionButton("See what\u2019s ahead  →", BusinessActionState.Default)
    }
}

@Composable
private fun DecisionsCard() {
    val theme = LocalBusinessTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(BusinessSpace.s16)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("DECISIONS")
            StatusPill("2 NEED YOU", BusinessStatusTone.Attention)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(BusinessSpace.s16)) {
            DecisionPreview(
                modifier = Modifier.weight(1f),
                fill = theme.palette.surface,
                icon = R.drawable.business_shield_plus,
                title = "Increase reserve coverage",
                body = "Reserve coverage is below the 90-day target.",
            )
            DecisionPreview(
                modifier = Modifier.weight(1f),
                fill = theme.palette.surfaceAlt,
                icon = R.drawable.business_shield_plus_alt,
                title = "Review customer concentration",
                body = "Top customer contributes 42% of recent receipts.",
            )
        }
        ActionButton("View Decisions  →", BusinessActionState.Default)
    }
}

@Composable
private fun MissionsCard() {
    val theme = LocalBusinessTheme.current
    Card(theme.palette.surfaceRaised) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Eyebrow("MISSIONS")
            StatusPill("2 ACTIVE", BusinessStatusTone.Goal)
        }
        Box(Modifier.fillMaxWidth().height(176.dp), contentAlignment = Alignment.Center) {
            KitIcon(R.drawable.business_ring, 176.dp)
            KitIcon(R.drawable.business_ring_track, 158.dp)
            KitIcon(R.drawable.business_ring_progress, 158.dp)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                KitIcon(R.drawable.business_target, 20.dp)
                KitText("59%", BusinessTypeScale.progress, FontWeight.ExtraBold, theme.palette.textPrimary)
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(BusinessRadius.inset))
                .background(theme.palette.surface)
                .border(1.dp, theme.palette.border, RoundedCornerShape(BusinessRadius.inset))
                .padding(BusinessSpace.s12),
            verticalArrangement = Arrangement.spacedBy(BusinessSpace.s8),
        ) {
            KitText("Strengthen Financial Protection", BusinessTypeScale.titleSmall, FontWeight.Bold, theme.palette.textPrimary)
            KitText("53 / 90 days · 59% · On track", BusinessTypeScale.bodySmall, FontWeight.Normal, theme.palette.positiveLabel)
            DividerLine()
            KitText("Reduce Business Dependency", BusinessTypeScale.titleSmall, FontWeight.Bold, theme.palette.textPrimary)
            KitText("Customer concentration · 42% → target ≤35%", BusinessTypeScale.bodySmall, FontWeight.Normal, theme.palette.textSecondary)
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(BusinessSpace.s8)
                    .clip(RoundedCornerShape(BusinessRadius.pill))
                    .background(theme.palette.divider),
            ) {
                Box(Modifier.fillMaxWidth(0.42f).fillMaxHeight().background(theme.palette.attentionLabel))
                Box(
                    Modifier
                        .padding(start = BusinessSpace.s36 * 1.6f)
                        .width(BusinessSpace.s4)
                        .fillMaxHeight()
                        .background(theme.palette.accent),
                )
            }
        }
        ActionButton("View Missions  →", BusinessActionState.Default)
    }
}

@Composable
private fun ImpactCard() {
    val theme = LocalBusinessTheme.current
    Card(theme.palette.surfaceRaised) {
        Eyebrow("M.I.L.E.")
        KitText("Money Impact & Business Evolution", BusinessTypeScale.bodySmall, FontWeight.Normal, theme.palette.textSecondary)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(BusinessSpace.s16)) {
            Box(
                Modifier
                    .size(72.dp)
                    .clip(RoundedCornerShape(BusinessRadius.symbol))
                    .background(theme.palette.symbolImpact),
                contentAlignment = Alignment.Center,
            ) {
                KitIcon(R.drawable.business_sprout, 30.dp)
            }
            Column {
                KitText("₹84,000", BusinessTypeScale.hero, FontWeight.ExtraBold, theme.palette.textPrimary)
                KitText("verified business financial impact", BusinessTypeScale.bodySmall, FontWeight.Normal, theme.palette.textSecondary)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(BusinessSpace.s8)) {
            StatusPill("+₹18,000 this month", BusinessStatusTone.Positive)
            StatusPill("Protection ↑", BusinessStatusTone.Positive)
        }
        ActionButton("See Business M.I.L.E.  →", BusinessActionState.Default)
    }
}

@Composable
private fun StatusRow() {
    Column(verticalArrangement = Arrangement.spacedBy(BusinessSpace.s12)) {
        PillExample("Neutral", "4 stable", BusinessStatusTone.Neutral, "Stable / neutral count")
        PillExample("Positive", "2 improving", BusinessStatusTone.Positive, "Improving / positive direction")
        PillExample("Attention", "2 watch", BusinessStatusTone.Attention, "Watch / attention required")
        PillExample("Goal", "2 ACTIVE", BusinessStatusTone.Goal, "Active / info, not goal reached")
    }
}

@Composable
private fun PillExample(title: String, label: String, tone: BusinessStatusTone, note: String) {
    val theme = LocalBusinessTheme.current
    Column(verticalArrangement = Arrangement.spacedBy(BusinessSpace.s6)) {
        KitText(title, BusinessTypeScale.bodySmall, FontWeight.Bold, theme.palette.textPrimary)
        StatusPill(label, tone)
        KitText(note, BusinessTypeScale.footnote, FontWeight.Normal, theme.palette.textSecondary)
    }
}

@Composable
private fun Card(fill: Color, content: @Composable () -> Unit) {
    val theme = LocalBusinessTheme.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(BusinessRadius.card))
            .background(fill)
            .border(1.dp, theme.palette.border, RoundedCornerShape(BusinessRadius.card))
            .padding(BusinessSpace.s24),
        verticalArrangement = Arrangement.spacedBy(BusinessSpace.s16),
    ) {
        content()
    }
}

@Composable
private fun DecisionPreview(
    modifier: Modifier,
    fill: Color,
    @DrawableRes icon: Int,
    title: String,
    body: String,
) {
    val theme = LocalBusinessTheme.current
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(BusinessRadius.card))
            .background(fill)
            .border(1.dp, theme.palette.border, RoundedCornerShape(BusinessRadius.card))
            .padding(BusinessSpace.s20),
        verticalArrangement = Arrangement.spacedBy(BusinessSpace.s14),
    ) {
        Box(
            Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(BusinessRadius.symbol))
                .background(theme.palette.symbolAttention),
            contentAlignment = Alignment.Center,
        ) {
            KitIcon(icon, 24.dp)
        }
        KitText(title, BusinessTypeScale.title, FontWeight.Bold, theme.palette.textPrimary)
        KitText(body, BusinessTypeScale.bodySmall, FontWeight.Normal, theme.palette.textSecondary)
    }
}

@Composable
private fun SignalRow(@DrawableRes icon: Int, title: String, body: String) {
    val theme = LocalBusinessTheme.current
    Row(horizontalArrangement = Arrangement.spacedBy(BusinessSpace.s14)) {
        Box(
            Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(BusinessRadius.symbol))
                .background(theme.palette.symbolAttention),
            contentAlignment = Alignment.Center,
        ) {
            KitIcon(icon, 28.dp)
        }
        Column(verticalArrangement = Arrangement.spacedBy(BusinessSpace.s6)) {
            KitText(title, BusinessTypeScale.bodyLarge, FontWeight.Bold, theme.palette.textPrimary)
            KitText(body, BusinessTypeScale.bodySmall, FontWeight.Normal, theme.palette.textSecondary)
        }
    }
}

@Composable
private fun DimensionRow(@DrawableRes icon: Int, title: String, body: String, mark: Color) {
    val theme = LocalBusinessTheme.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(BusinessSpace.s12)) {
        KitIcon(icon, 40.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(BusinessSpace.s4)) {
            KitText(title, BusinessTypeScale.bodyLarge, FontWeight.Bold, theme.palette.textPrimary)
            KitText(body, BusinessTypeScale.footnote, FontWeight.Normal, theme.palette.textSecondary)
        }
        KitText("›", BusinessTypeScale.display, FontWeight.Normal, mark)
    }
}

@Composable
private fun ActionButton(label: String, state: BusinessActionState) {
    val theme = LocalBusinessTheme.current
    val fill = when (state) {
        BusinessActionState.Default -> theme.action.default
        BusinessActionState.Hover -> theme.action.hover
        BusinessActionState.Pressed -> theme.action.pressed
        BusinessActionState.Disabled -> theme.palette.disabledFill
    }
    val labelColor = if (state == BusinessActionState.Disabled) theme.palette.disabledLabel else theme.action.label
    val border = if (state == BusinessActionState.Disabled) theme.palette.disabledBorder else theme.action.border
    val shape = RoundedCornerShape(BusinessRadius.action)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(shape)
            .background(fill)
            .border(1.dp, border, shape),
        contentAlignment = Alignment.Center,
    ) {
        KitText(label, BusinessTypeScale.body, FontWeight.Bold, labelColor, TextAlign.Center)
    }
}

@Composable
private fun StatusPill(label: String, tone: BusinessStatusTone) {
    val theme = LocalBusinessTheme.current
    val shape = RoundedCornerShape(BusinessRadius.pill)
    Box(
        modifier = Modifier
            .clip(shape)
            .background(theme.palette.fill(tone))
            .border(1.dp, theme.palette.border(tone), shape)
            .padding(horizontal = BusinessSpace.s12, vertical = BusinessSpace.s6),
    ) {
        KitText(label, BusinessTypeScale.caption, FontWeight.SemiBold, theme.palette.label(tone))
    }
}

@Composable
private fun KitIcon(@DrawableRes id: Int, size: Dp) {
    Image(
        painter = painterResource(id),
        contentDescription = null,
        modifier = Modifier.size(size),
        contentScale = ContentScale.Fit,
    )
}

@Composable
private fun Eyebrow(text: String) {
    val theme = LocalBusinessTheme.current
    KitText(text, BusinessTypeScale.caption, FontWeight.ExtraBold, theme.palette.textPrimary)
}

@Composable
private fun SectionLabel(text: String) {
    val theme = LocalBusinessTheme.current
    KitText(text, BusinessTypeScale.title, FontWeight.Bold, theme.palette.textPrimary)
}

@Composable
private fun DividerLine() {
    val theme = LocalBusinessTheme.current
    Box(Modifier.fillMaxWidth().height(1.dp).background(theme.palette.divider))
}

@Composable
private fun KitText(
    text: String,
    size: TextUnit,
    weight: FontWeight,
    color: Color,
    align: TextAlign = TextAlign.Start,
) {
    val theme = LocalBusinessTheme.current
    Text(
        text = text,
        color = color,
        fontFamily = theme.fontFamily,
        fontWeight = weight,
        fontSize = size,
        lineHeight = size * BusinessTypeScale.bodyLineHeight,
        textAlign = align,
    )
}
