package com.monytix.app.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class BusinessPalette(
    val canvas: Color,
    val surface: Color,
    val surfaceRaised: Color,
    val surfaceAlt: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val accent: Color,
    val border: Color,
    val divider: Color,
    val neutralFill: Color,
    val neutralBorder: Color,
    val neutralLabel: Color,
    val positiveFill: Color,
    val positiveBorder: Color,
    val positiveLabel: Color,
    val attentionFill: Color,
    val attentionBorder: Color,
    val attentionLabel: Color,
    val goalFill: Color,
    val goalBorder: Color,
    val goalLabel: Color,
    val symbolAttention: Color,
    val symbolImpact: Color,
    val disabledFill: Color,
    val disabledBorder: Color,
    val disabledLabel: Color,
)

data class BusinessAction(
    val default: Color,
    val hover: Color,
    val pressed: Color,
    val border: Color,
    val label: Color,
)

object BusinessTypeScale {
    val caption: TextUnit = 12.sp
    val footnote: TextUnit = 13.sp
    val bodySmall: TextUnit = 14.sp
    val body: TextUnit = 15.sp
    val bodyLarge: TextUnit = 16.sp
    val titleSmall: TextUnit = 18.sp
    val title: TextUnit = 20.sp
    val headline: TextUnit = 25.sp
    val display: TextUnit = 26.sp
    val status: TextUnit = 38.sp
    val hero: TextUnit = 40.sp
    val progress: TextUnit = 44.sp
    const val bodyLineHeight = 1.4f
}

object BusinessSpace {
    val s4 = 4.dp
    val s6 = 6.dp
    val s8 = 8.dp
    val s12 = 12.dp
    val s14 = 14.dp
    val s16 = 16.dp
    val s18 = 18.dp
    val s20 = 20.dp
    val s22 = 22.dp
    val s24 = 24.dp
    val s28 = 28.dp
    val s36 = 36.dp
    val s40 = 40.dp
}

object BusinessRadius {
    val action = 18.dp
    val card = 28.dp
    val inset = 20.dp
    val symbol = 13.dp
    val pill = 999.dp
}

object BusinessTokens {
    val action = BusinessAction(
        default = Color(0xFFF7C663),
        hover = Color(0xFFF9D183),
        pressed = Color(0xFFE9B64E),
        border = Color(0xFFE5AA38),
        label = Color(0xFF12181F),
    )

    val light = BusinessPalette(
        canvas = Color(0xFFF4F7FA),
        surface = Color(0xFFFFFFFF),
        surfaceRaised = Color(0xFFEAF2F6),
        surfaceAlt = Color(0xFFEEF4F8),
        textPrimary = Color(0xFF12181F),
        textSecondary = Color(0xFF5B6D7A),
        accent = Color(0xFF146F65),
        border = Color(0xFFD7E0E6),
        divider = Color(0xFFD7E0E6),
        neutralFill = Color(0xFFEAF2F6),
        neutralBorder = Color(0xFFD7E0E6),
        neutralLabel = Color(0xFF6B7A8A),
        positiveFill = Color(0xFFEAF2F6),
        positiveBorder = Color(0xFFD7E0E6),
        positiveLabel = Color(0xFF146F65),
        attentionFill = Color(0xFFF7E8E1),
        attentionBorder = Color(0xFFE8D7D0),
        attentionLabel = Color(0xFFA34E47),
        goalFill = Color(0xFFEAF2F6),
        goalBorder = Color(0xFFD7E0E6),
        goalLabel = Color(0xFF6B7A8A),
        symbolAttention = Color(0xFFFFD3C5),
        symbolImpact = Color(0xFFFFE19B),
        disabledFill = Color(0xFFDCE4EA),
        disabledBorder = Color(0xFFD7E0E6),
        disabledLabel = Color(0xFF586875),
    )

    val dark = BusinessPalette(
        canvas = Color(0xFF0F1418),
        surface = Color(0xFF1B2329),
        surfaceRaised = Color(0xFF26343D),
        surfaceAlt = Color(0xFF26343D),
        textPrimary = Color(0xFFE8F0F4),
        textSecondary = Color(0xFFAEC0D9),
        accent = Color(0xFF5CB8AA),
        border = Color(0xFF3B4B55),
        divider = Color(0xFF3B4B55),
        neutralFill = Color(0xFF26343D),
        neutralBorder = Color(0xFF3B4B55),
        neutralLabel = Color(0xFFA8C0D0),
        positiveFill = Color(0xFF193F3D),
        positiveBorder = Color(0xFF3B4B55),
        positiveLabel = Color(0xFF5CB8AA),
        attentionFill = Color(0xFF26343D),
        attentionBorder = Color(0xFF3B4B55),
        attentionLabel = Color(0xFFEDB5B1),
        goalFill = Color(0xFF193F3D),
        goalBorder = Color(0xFF3B4B55),
        goalLabel = Color(0xFF5CB8AA),
        symbolAttention = Color(0xFF20324D),
        symbolImpact = Color(0xFF193F3D),
        disabledFill = Color(0xFF34424B),
        disabledBorder = Color(0xFF3B4B55),
        disabledLabel = Color(0xFFB6C4CE),
    )
}
