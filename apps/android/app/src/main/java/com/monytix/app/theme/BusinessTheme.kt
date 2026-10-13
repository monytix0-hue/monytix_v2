package com.monytix.app.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.monytix.app.R

enum class BusinessActionState {
    Default,
    Hover,
    Pressed,
    Disabled,
}

enum class BusinessStatusTone {
    Neutral,
    Positive,
    Attention,
    Goal,
}

@Immutable
data class BusinessThemeState(
    val isDark: Boolean,
    val palette: BusinessPalette,
    val action: BusinessAction,
    val fontFamily: FontFamily,
)

val LocalBusinessTheme = staticCompositionLocalOf {
    BusinessThemeState(
        isDark = false,
        palette = BusinessTokens.light,
        action = BusinessTokens.action,
        fontFamily = FontFamily.Default,
    )
}

private val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
    Font(R.font.inter_extrabold, FontWeight.ExtraBold),
)

private fun lineHeight(size: androidx.compose.ui.unit.TextUnit) =
    size * BusinessTypeScale.bodyLineHeight

private fun BusinessPalette.toColorScheme(dark: Boolean) = (
    if (dark) darkColorScheme() else lightColorScheme()
    ).copy(
    background = canvas,
    surface = surface,
    surfaceContainer = surfaceRaised,
    onBackground = textPrimary,
    onSurface = textPrimary,
    onSurfaceVariant = textSecondary,
    primary = accent,
    onPrimary = surface,
    outline = border,
    outlineVariant = divider,
)

@Composable
fun BusinessTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val palette = if (darkTheme) BusinessTokens.dark else BusinessTokens.light
    val typography = Typography(
        displaySmall = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.ExtraBold,
            fontSize = BusinessTypeScale.display,
            lineHeight = lineHeight(BusinessTypeScale.display),
            color = palette.textPrimary,
        ),
        headlineMedium = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.ExtraBold,
            fontSize = BusinessTypeScale.headline,
            color = palette.textPrimary,
        ),
        titleLarge = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Bold,
            fontSize = BusinessTypeScale.title,
            color = palette.textPrimary,
        ),
        titleMedium = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Bold,
            fontSize = BusinessTypeScale.titleSmall,
            color = palette.textPrimary,
        ),
        bodyLarge = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Normal,
            fontSize = BusinessTypeScale.bodyLarge,
            lineHeight = lineHeight(BusinessTypeScale.bodyLarge),
            color = palette.textSecondary,
        ),
        bodyMedium = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Normal,
            fontSize = BusinessTypeScale.bodySmall,
            lineHeight = lineHeight(BusinessTypeScale.bodySmall),
            color = palette.textSecondary,
        ),
        bodySmall = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Normal,
            fontSize = BusinessTypeScale.footnote,
            lineHeight = lineHeight(BusinessTypeScale.footnote),
            color = palette.textSecondary,
        ),
        labelLarge = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Bold,
            fontSize = BusinessTypeScale.body,
            color = palette.textPrimary,
        ),
        labelSmall = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.SemiBold,
            fontSize = BusinessTypeScale.caption,
            color = palette.textPrimary,
        ),
    )
    val shapes = Shapes(
        extraSmall = RoundedCornerShape(BusinessRadius.symbol),
        small = RoundedCornerShape(BusinessRadius.action),
        medium = RoundedCornerShape(BusinessRadius.inset),
        large = RoundedCornerShape(BusinessRadius.card),
        extraLarge = RoundedCornerShape(BusinessRadius.card),
    )
    CompositionLocalProvider(
        LocalBusinessTheme provides BusinessThemeState(
            isDark = darkTheme,
            palette = palette,
            action = BusinessTokens.action,
            fontFamily = Inter,
        ),
    ) {
        MaterialTheme(
            colorScheme = palette.toColorScheme(darkTheme),
            typography = typography,
            shapes = shapes,
            content = content,
        )
    }
}

fun BusinessPalette.fill(tone: BusinessStatusTone): Color = when (tone) {
    BusinessStatusTone.Neutral -> neutralFill
    BusinessStatusTone.Positive -> positiveFill
    BusinessStatusTone.Attention -> attentionFill
    BusinessStatusTone.Goal -> goalFill
}

fun BusinessPalette.border(tone: BusinessStatusTone): Color = when (tone) {
    BusinessStatusTone.Neutral -> neutralBorder
    BusinessStatusTone.Positive -> positiveBorder
    BusinessStatusTone.Attention -> attentionBorder
    BusinessStatusTone.Goal -> goalBorder
}

fun BusinessPalette.label(tone: BusinessStatusTone): Color = when (tone) {
    BusinessStatusTone.Neutral -> neutralLabel
    BusinessStatusTone.Positive -> positiveLabel
    BusinessStatusTone.Attention -> attentionLabel
    BusinessStatusTone.Goal -> goalLabel
}
