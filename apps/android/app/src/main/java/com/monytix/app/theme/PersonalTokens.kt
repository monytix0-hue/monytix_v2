package com.monytix.app.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class PersonalPalette(
    val canvas: Color,
    val surface: Color,
    val surfaceRaised: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val accent: Color,
    val border: Color,
    val divider: Color,
    val widgetGoalStart: Color,
    val widgetGoalMid: Color,
    val widgetGoalEnd: Color,
    val widgetGoalBorder: Color,
    val widgetDecision: Color,
    val widgetDecisionBorder: Color,
    val widgetChange: Color,
    val widgetChangeBorder: Color,
    val widgetCashStart: Color,
    val widgetCashEnd: Color,
    val widgetCashBorder: Color,
    val widgetWeight: Color,
    val widgetWeightBorder: Color,
    val widgetImpactStart: Color,
    val widgetImpactEnd: Color,
    val widgetImpactBorder: Color,
    val popover: Color,
    val popoverBorder: Color,
    val pointer: Color,
    val sheet: Color,
    val sheetBorder: Color,
    val backdrop: Color,
    val anchor: Color,
    val closeFill: Color,
    val dismiss: Color,
    val mission: Color,
    val progressTrack: Color,
    val progressFill: Color,
    val dragHandle: Color,
    val cashFlexible: Color,
    val cashCommitted: Color,
)

data class PersonalStatus(
    val gold: Color,
    val goldBorder: Color,
    val mint: Color,
    val mintBorder: Color,
    val coral: Color,
    val coralBorder: Color,
    val lavender: Color,
    val lavenderBorder: Color,
)

data class PersonalAction(
    val default: Color,
    val hover: Color,
    val pressed: Color,
    val disabledFill: Color,
    val disabledLabel: Color,
    val label: Color,
)

data class PersonalElevation(
    val offsetY: Dp,
    val blur: Dp,
    val color: Color,
)

data class PersonalElevations(
    val action: PersonalElevation,
    val card: PersonalElevation,
    val sheet: PersonalElevation,
)

object PersonalTypeScale {
    val caption: TextUnit = 11.sp
    val footnote: TextUnit = 13.sp
    val bodySmall: TextUnit = 14.sp
    val body: TextUnit = 15.sp
    val bodyLarge: TextUnit = 16.sp
    val titleSmall: TextUnit = 18.sp
    val title: TextUnit = 20.sp
    val headline: TextUnit = 24.sp
    val display: TextUnit = 26.sp
    val amount: TextUnit = 36.sp
    val hero: TextUnit = 40.sp
    const val bodyLineHeight = 1.4f
}

object PersonalSpace {
    val s4 = 4.dp
    val s6 = 6.dp
    val s8 = 8.dp
    val s12 = 12.dp
    val s14 = 14.dp
    val s16 = 16.dp
    val s20 = 20.dp
    val s24 = 24.dp
    val s28 = 28.dp
    val s32 = 32.dp
    val s48 = 48.dp
}

object PersonalRadius {
    val action = 18.dp
    val card = 28.dp
    val popover = 24.dp
    val sheet = 28.dp
    val pill = 999.dp
    val inset = 20.dp
}

object PersonalTokens {
    val status = PersonalStatus(
        gold = Color(0xFFF7C663),
        goldBorder = Color(0xFFE5AA38),
        mint = Color(0xFFBCE9DB),
        mintBorder = Color(0xFF8BD7C0),
        coral = Color(0xFFFFD4CA),
        coralBorder = Color(0xFFF4B9A9),
        lavender = Color(0xFFDED3FA),
        lavenderBorder = Color(0xFFCDB9F3),
    )

    val action = PersonalAction(
        default = Color(0xFFF7C663),
        hover = Color(0xFFFFD47D),
        pressed = Color(0xFFE9AF3E),
        disabledFill = Color(0xFFE7E7E2),
        disabledLabel = Color(0xFF777D79),
        label = Color(0xFF12181F),
    )

    val elevation = PersonalElevations(
        action = PersonalElevation(3.dp, 4.dp, Color(0xFF2B1F0F).copy(alpha = 0.15f)),
        card = PersonalElevation(5.dp, 16.dp, Color(0xFF18382E).copy(alpha = 0.04f)),
        sheet = PersonalElevation(12.dp, 32.dp, Color(0xFF20332D).copy(alpha = 0.12f)),
    )

    val light = PersonalPalette(
        canvas = Color(0xFFF9FAF8),
        surface = Color(0xFFFFFFFF),
        surfaceRaised = Color(0xFFF2F5F2),
        textPrimary = Color(0xFF12181F),
        textSecondary = Color(0xFF2F3634),
        accent = Color(0xFF003731),
        border = Color(0xFFE3E5E5),
        divider = Color(0xFFE3E5E5),
        widgetGoalStart = Color(0xFFFFF2D7),
        widgetGoalMid = Color(0xFFFFEDE5),
        widgetGoalEnd = Color(0xFFEAE5FF),
        widgetGoalBorder = Color(0xFFDDC4A6),
        widgetDecision = Color(0xFFFFE3DB),
        widgetDecisionBorder = Color(0xFFF4B9A9),
        widgetChange = Color(0xFFFFFFFF),
        widgetChangeBorder = Color(0xFFE3E5E5),
        widgetCashStart = Color(0xFFDCF5EE),
        widgetCashEnd = Color(0xFFDCF5EE),
        widgetCashBorder = Color(0xFF8BD7C0),
        widgetWeight = Color(0xFFEAE1FF),
        widgetWeightBorder = Color(0xFFCDB9F3),
        widgetImpactStart = Color(0xFFFFF0D4),
        widgetImpactEnd = Color(0xFFFFF0D4),
        widgetImpactBorder = Color(0xFFF0CA82),
        popover = Color(0xFFFFFFFF),
        popoverBorder = Color(0xFFF0CA82),
        pointer = Color(0xFFFFFFFF),
        sheet = Color(0xFFFFFFFF),
        sheetBorder = Color(0xFFE3E5E5),
        backdrop = Color(0xFFDDE6E1),
        anchor = Color(0xFFF2F5F2),
        closeFill = Color(0xFFFFFFFF),
        dismiss = Color(0xFFF7F2FF),
        mission = Color(0xFFFFF0D4),
        progressTrack = Color(0xFFFFFFFF),
        progressFill = Color(0xFFE59A28),
        dragHandle = Color(0xFFBFC8C2),
        cashFlexible = Color(0xFF83D8CF),
        cashCommitted = Color(0xFFEDB5B1),
    )

    val dark = PersonalPalette(
        canvas = Color(0xFF0A1530),
        surface = Color(0xFF14264A),
        surfaceRaised = Color(0xFF20304A),
        textPrimary = Color(0xFFE8F0F4),
        textSecondary = Color(0xFFBACAC5),
        accent = Color(0xFF57F1DB),
        border = Color(0xFF344568),
        divider = Color(0xFF344568),
        widgetGoalStart = Color(0xFF203A62),
        widgetGoalMid = Color(0xFF203A62),
        widgetGoalEnd = Color(0xFF14264A),
        widgetGoalBorder = Color(0xFF344568),
        widgetDecision = Color(0xFF252A40),
        widgetDecisionBorder = Color(0xFF344568),
        widgetChange = Color(0xFF14264A),
        widgetChangeBorder = Color(0xFF344568),
        widgetCashStart = Color(0xFF1B464E),
        widgetCashEnd = Color(0xFF142C42),
        widgetCashBorder = Color(0xFF344568),
        widgetWeight = Color(0xFF27243F),
        widgetWeightBorder = Color(0xFF344568),
        widgetImpactStart = Color(0xFF334041),
        widgetImpactEnd = Color(0xFF14264A),
        widgetImpactBorder = Color(0xFF344568),
        popover = Color(0xFF071124),
        popoverBorder = Color(0xFFE9BE80),
        pointer = Color(0xFF0A1530),
        sheet = Color(0xFF14264A),
        sheetBorder = Color(0xFF344568),
        backdrop = Color(0xFF071124),
        anchor = Color(0xFF20304A),
        closeFill = Color(0xFF1A2E52),
        dismiss = Color(0xFF252B45),
        mission = Color(0xFF20304A),
        progressTrack = Color(0xFF344568),
        progressFill = Color(0xFFE59A28),
        dragHandle = Color(0xFFBFC8C2),
        cashFlexible = Color(0xFF83D8CF),
        cashCommitted = Color(0xFFEDB5B1),
    )
}
