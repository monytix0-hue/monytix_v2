package com.monytix.app.theme

import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.foundation.shape.RoundedCornerShape
import com.monytix.app.R

enum class PersonalActionState {
    Default,
    Hover,
    Pressed,
    Disabled,
}

enum class PersonalStatusTone {
    Gold,
    Mint,
    Coral,
    Lavender,
}

@Immutable
data class PersonalThemeState(
    val isDark: Boolean,
    val palette: PersonalPalette,
    val status: PersonalStatus,
    val action: PersonalAction,
    val elevation: PersonalElevations,
    val fontFamily: FontFamily,
)

val LocalPersonalTheme = staticCompositionLocalOf {
    PersonalThemeState(
        isDark = false,
        palette = PersonalTokens.light,
        status = PersonalTokens.status,
        action = PersonalTokens.action,
        elevation = PersonalTokens.elevation,
        fontFamily = FontFamily.Default,
    )
}

private val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_bold, FontWeight.Bold),
    Font(R.font.inter_extrabold, FontWeight.ExtraBold),
)

private fun lineHeight(size: androidx.compose.ui.unit.TextUnit) =
    size * PersonalTypeScale.bodyLineHeight

private fun PersonalPalette.toColorScheme(dark: Boolean) = (
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
fun PersonalTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val palette = if (darkTheme) PersonalTokens.dark else PersonalTokens.light
    val typography = Typography(
        displaySmall = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.ExtraBold,
            fontSize = PersonalTypeScale.display,
            lineHeight = lineHeight(PersonalTypeScale.display),
            color = palette.textPrimary,
        ),
        headlineMedium = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.ExtraBold,
            fontSize = PersonalTypeScale.headline,
            color = palette.textPrimary,
        ),
        titleLarge = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Bold,
            fontSize = PersonalTypeScale.title,
            color = palette.textPrimary,
        ),
        titleMedium = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Bold,
            fontSize = PersonalTypeScale.titleSmall,
            color = palette.textPrimary,
        ),
        bodyLarge = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Normal,
            fontSize = PersonalTypeScale.bodyLarge,
            lineHeight = lineHeight(PersonalTypeScale.bodyLarge),
            color = palette.textSecondary,
        ),
        bodyMedium = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Normal,
            fontSize = PersonalTypeScale.bodySmall,
            lineHeight = lineHeight(PersonalTypeScale.bodySmall),
            color = palette.textSecondary,
        ),
        bodySmall = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Normal,
            fontSize = PersonalTypeScale.footnote,
            lineHeight = lineHeight(PersonalTypeScale.footnote),
            color = palette.textSecondary,
        ),
        labelLarge = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.Bold,
            fontSize = PersonalTypeScale.bodySmall,
            color = palette.textPrimary,
        ),
        labelSmall = TextStyle(
            fontFamily = Inter,
            fontWeight = FontWeight.ExtraBold,
            fontSize = PersonalTypeScale.caption,
            color = palette.textPrimary,
        ),
    )
    val shapes = Shapes(
        extraSmall = RoundedCornerShape(PersonalRadius.action),
        small = RoundedCornerShape(PersonalRadius.action),
        medium = RoundedCornerShape(PersonalRadius.popover),
        large = RoundedCornerShape(PersonalRadius.card),
        extraLarge = RoundedCornerShape(PersonalRadius.sheet),
    )
    val theme = PersonalThemeState(
        isDark = darkTheme,
        palette = palette,
        status = PersonalTokens.status,
        action = PersonalTokens.action,
        elevation = PersonalTokens.elevation,
        fontFamily = Inter,
    )
    CompositionLocalProvider(LocalPersonalTheme provides theme) {
        MaterialTheme(
            colorScheme = palette.toColorScheme(darkTheme),
            typography = typography,
            shapes = shapes,
            content = content,
        )
    }
}

fun PersonalStatus.color(tone: PersonalStatusTone): Color = when (tone) {
    PersonalStatusTone.Gold -> gold
    PersonalStatusTone.Mint -> mint
    PersonalStatusTone.Coral -> coral
    PersonalStatusTone.Lavender -> lavender
}

fun PersonalStatus.border(tone: PersonalStatusTone): Color = when (tone) {
    PersonalStatusTone.Gold -> goldBorder
    PersonalStatusTone.Mint -> mintBorder
    PersonalStatusTone.Coral -> coralBorder
    PersonalStatusTone.Lavender -> lavenderBorder
}
