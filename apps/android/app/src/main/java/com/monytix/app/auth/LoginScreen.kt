package com.monytix.app.auth

import android.app.Activity
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.monytix.app.R
import com.monytix.app.theme.BusinessRadius
import com.monytix.app.theme.BusinessSpace
import com.monytix.app.theme.BusinessTypeScale
import com.monytix.app.theme.LocalBusinessTheme
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(
    session: AuthSession,
    api: MonytixApi,
    onSignedIn: () -> Unit,
) {
    val theme = LocalBusinessTheme.current
    val scope = rememberCoroutineScope()
    val activity = LocalContext.current as Activity
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.canvas)
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = BusinessSpace.s28)
            .padding(top = 72.dp, bottom = BusinessSpace.s28),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(BusinessSpace.s16),
    ) {
        Image(
            painter = painterResource(R.drawable.ic_monytix_omark),
            contentDescription = "Monytix",
            contentScale = ContentScale.Fit,
            modifier = Modifier.height(72.dp),
        )
        Text(
            text = if (creating) "Create your account" else "Sign in",
            color = theme.palette.textPrimary,
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = BusinessTypeScale.title,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "Your money, right now",
            color = theme.palette.textSecondary,
            fontFamily = theme.fontFamily,
            fontSize = BusinessTypeScale.body,
            textAlign = TextAlign.Center,
        )
        LabeledField(
            label = "Email",
            value = email,
            onValueChange = { email = it },
            keyboardType = KeyboardType.Email,
        )
        LabeledField(
            label = "Password",
            value = password,
            onValueChange = { password = it },
            keyboardType = KeyboardType.Password,
            password = true,
        )
        message?.let {
            Text(
                text = it,
                color = theme.palette.attentionLabel,
                fontFamily = theme.fontFamily,
                fontSize = BusinessTypeScale.bodySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        GoldButton(if (creating) "Create account" else "Sign in", enabled = !busy) {
            scope.launch {
                busy = true
                message = null
                val result = if (creating) session.createAccount(email, password) else session.signIn(email, password)
                message = finish(result, session, api)
                if (message == null) {
                    onSignedIn()
                }
                busy = false
            }
        }
        OrDivider()
        OutlinedButton("Continue with Google", enabled = !busy) {
            scope.launch {
                busy = true
                message = null
                val result = session.signInWithGoogle(activity)
                message = finish(result, session, api)
                if (message == null) {
                    onSignedIn()
                }
                busy = false
            }
        }
        Text(
            text = if (creating) "Have an account? Sign in" else "New here? Create account",
            color = theme.palette.accent,
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = BusinessTypeScale.body,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = !busy) { creating = !creating }
                .padding(top = BusinessSpace.s8),
        )
    }
}

private suspend fun finish(result: AuthResult, session: AuthSession, api: MonytixApi): String? {
    if (result is AuthResult.Failed) {
        return result.message
    }
    return when (val confirmed = api.confirmSession { force -> session.idToken(force) }) {
        ConfirmResult.Confirmed, ConfirmResult.Skipped -> null
        is ConfirmResult.Rejected -> confirmed.message
    }
}

@Composable
private fun LabeledField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    keyboardType: KeyboardType,
    password: Boolean = false,
) {
    val theme = LocalBusinessTheme.current
    val shape = RoundedCornerShape(BusinessRadius.action)
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(BusinessSpace.s8),
    ) {
        Text(
            text = label,
            color = theme.palette.textSecondary,
            fontFamily = theme.fontFamily,
            fontSize = BusinessTypeScale.bodySmall,
        )
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(
                color = theme.palette.textPrimary,
                fontFamily = theme.fontFamily,
                fontSize = BusinessTypeScale.body,
            ),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            cursorBrush = SolidColor(theme.palette.accent),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(shape)
                .background(theme.palette.surface)
                .border(1.dp, theme.palette.border, shape)
                .padding(horizontal = BusinessSpace.s16),
            decorationBox = { inner ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                    inner()
                }
            },
        )
    }
}

@Composable
private fun OrDivider() {
    val theme = LocalBusinessTheme.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = BusinessSpace.s4),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(BusinessSpace.s12),
    ) {
        Box(
            Modifier
                .weight(1f)
                .height(1.dp)
                .background(theme.palette.divider),
        )
        Text(
            text = "or",
            color = theme.palette.textSecondary,
            fontFamily = theme.fontFamily,
            fontSize = BusinessTypeScale.caption,
        )
        Box(
            Modifier
                .weight(1f)
                .height(1.dp)
                .background(theme.palette.divider),
        )
    }
}

@Composable
private fun GoldButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    val theme = LocalBusinessTheme.current
    val fill = if (enabled) theme.action.default else theme.palette.disabledFill
    val labelColor = if (enabled) theme.action.label else theme.palette.disabledLabel
    val border = if (enabled) theme.action.border else theme.palette.disabledBorder
    val shape = RoundedCornerShape(BusinessRadius.action)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(shape)
            .background(fill)
            .border(1.dp, border, shape)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = labelColor,
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = BusinessTypeScale.body,
        )
    }
}

@Composable
private fun OutlinedButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    val theme = LocalBusinessTheme.current
    val fill = if (enabled) theme.palette.surface else theme.palette.disabledFill
    val labelColor = if (enabled) theme.palette.textPrimary else theme.palette.disabledLabel
    val border = if (enabled) theme.palette.border else theme.palette.disabledBorder
    val shape = RoundedCornerShape(BusinessRadius.action)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(shape)
            .background(fill)
            .border(1.dp, border, shape)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = labelColor,
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = BusinessTypeScale.body,
        )
    }
}
