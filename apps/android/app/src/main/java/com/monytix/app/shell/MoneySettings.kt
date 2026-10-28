package com.monytix.app.shell

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.R
import com.monytix.app.auth.MonytixApi
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace
import com.monytix.app.theme.PersonalTokens
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.math.BigDecimal
import java.util.Locale

/**
 * The owner's money settings: home currency, timezone and country.
 *
 * These are the three inputs that decide how the ledger is *read*, and none of them is
 * a ledger write. Changing the home currency changes the converted roll-up; every
 * booked amount keeps its own currency and its own figure. The footer says so, and so
 * does the warning returned by a save that leaves accounts in a currency the owner no
 * longer calls home.
 */
@Composable
fun MoneySettings(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    store: UiSessionStore,
    onBack: () -> Unit,
) {
    val theme = LocalPersonalTheme.current
    val scope = rememberCoroutineScope()
    var preferences by remember { mutableStateOf(store.preferences) }
    var held by remember { mutableStateOf(emptyList<String>()) }
    var isDefaultCurrency by remember { mutableStateOf(true) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var currency by remember { mutableStateOf(preferences?.defaultCurrencyCode.orEmpty()) }
    var timezone by remember { mutableStateOf(preferences?.timezoneName.orEmpty()) }
    var country by remember { mutableStateOf(preferences?.countryCode.orEmpty()) }

    // Everything the server will accept, plus the codes already held so the picker
    // never hides one the owner actually has money in.
    val choices = remember(held, currency) {
        (held + listOf("INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD") + currency)
            .filter { it.length == 3 }
            .distinct()
            .sorted()
    }

    fun apply(root: JSONObject) {
        OwnerPreferences.from(root.optJSONObject("preferences"))?.let { preferences = it }
        val heldRows = root.optJSONArray("held_currencies")
        held = buildList {
            if (heldRows != null) {
                for (index in 0 until heldRows.length()) {
                    heldRows.optString(index).takeIf { it.isNotBlank() }?.let { add(it.uppercase(Locale.ROOT)) }
                }
            }
        }
        isDefaultCurrency = root.optBoolean("is_default_currency", false)
        preferences?.let { current ->
            currency = current.defaultCurrencyCode
            timezone = current.timezoneName
            country = current.countryCode.orEmpty()
        }
    }

    fun save(patch: Map<String, Any?>) {
        scope.launch {
            saving = true
            error = null
            notice = null
            try {
                val body = JSONObject().apply {
                    patch.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) }
                }
                val result = api.submit(
                    method = "PATCH",
                    path = "/v1/owner/preferences",
                    jsonBody = body.toString(),
                    idempotencyKey = java.util.UUID.randomUUID().toString(),
                    token = token,
                )
                val root = result.text?.let { runCatching { JSONObject(it) }.getOrNull() }
                if (result.status !in 200..299 || root == null) {
                    error = "That value was not accepted."
                    return@launch
                }
                apply(root)
                // The warning says *why* a successful save is worth a second look, e.g.
                // moving home to USD while every account is still INR.
                val warnings = root.optJSONArray("warnings")
                if (warnings != null && warnings.length() > 0) {
                    notice = warnings.optJSONObject(0)?.optString("message")?.takeIf { it.isNotBlank() }
                }
                // The bootstrap carries the preferences and formats every tab reads,
                // so it is reread rather than patched locally.
                store.prefetch()
            } finally {
                saving = false
            }
        }
    }

    LaunchedEffect(Unit) {
        val json = api.getJson("/v1/owner/preferences", token)
        val root = json?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (root == null) {
            error = "Could not read your preferences."
        } else {
            apply(root)
        }
        loading = false
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PersonalSpace.s20)
            .padding(top = PersonalSpace.s16, bottom = PersonalSpace.s32),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s20),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
        ) {
            Box(
                modifier = Modifier
                    .height(40.dp)
                    .clickable { onBack() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painter = painterResource(R.drawable.fig_chevron),
                    contentDescription = "Back",
                    tint = theme.palette.textPrimary,
                )
            }
            Column {
                Text("Money settings", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                Text("How amounts are read and shown", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
            }
        }

        if (loading) {
            Text("Loading", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
        } else {
            SettingsCard {
                // The first-run confirmation. It only appears while the owner has never
                // moved off the untouched INR default, which is exactly when a wrong
                // home currency is most likely and least visible.
                if (isDefaultCurrency) {
                    Text("Confirm your home currency", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(
                        "Reports are totalled in this currency. Each transaction keeps the currency it was booked in, so nothing in the ledger changes — only the totals you see.",
                        color = theme.palette.textSecondary,
                        fontFamily = theme.fontFamily,
                        fontSize = 13.sp,
                    )
                    if (held.isNotEmpty()) {
                        Text(
                            "Accounts in this ledger: ${held.joinToString(", ")}",
                            color = theme.palette.textSecondary,
                            fontFamily = theme.fontFamily,
                            fontSize = 13.sp,
                        )
                    }
                } else {
                    Text("Home currency", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(
                        "Totals and insights are converted into this currency at each transaction's own date.",
                        color = theme.palette.textSecondary,
                        fontFamily = theme.fontFamily,
                        fontSize = 13.sp,
                    )
                }
                ChoiceRow(
                    label = "Home currency",
                    value = currency,
                    choices = choices,
                    enabled = !saving,
                    display = { code ->
                        val units = store.minorUnits(code) ?: 2
                        "$code — ${Money.format(BigDecimal("1234.5"), code, minorUnits = units)}"
                    },
                    onSelect = { currency = it },
                )
                SaveButton("Save currency", saving || currency == preferences?.defaultCurrencyCode) {
                    save(mapOf("default_currency_code" to currency))
                }
            }

            SettingsCard {
                Text("Timezone", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                // A statement alert with no offset is placed by this zone, so it decides
                // which month a late-evening transaction belongs to.
                Text(
                    "Decides which date a transaction falls on, and supplies the offset for alerts that carry none.",
                    color = theme.palette.textSecondary,
                    fontFamily = theme.fontFamily,
                    fontSize = 13.sp,
                )
                OutlinedTextField(
                    value = timezone,
                    onValueChange = { timezone = it },
                    singleLine = true,
                    enabled = !saving,
                    label = { Text("Asia/Kolkata", fontFamily = theme.fontFamily) },
                )
                SaveButton("Save timezone", saving || timezone == preferences?.timezoneName) {
                    save(mapOf("timezone_name" to timezone))
                }
            }

            SettingsCard {
                Text("Country", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                // The country is the tiebreaker for `$` and the selector for the wording
                // pack, so it is worth setting even when the currency is already right.
                Text(
                    "Resolves an ambiguous currency symbol and picks the alert wording for your market. A two-letter ISO code, or blank to let the sender decide.",
                    color = theme.palette.textSecondary,
                    fontFamily = theme.fontFamily,
                    fontSize = 13.sp,
                )
                OutlinedTextField(
                    value = country,
                    onValueChange = { country = it.uppercase(Locale.ROOT) },
                    singleLine = true,
                    enabled = !saving,
                    label = { Text("IN", fontFamily = theme.fontFamily) },
                )
                SaveButton("Save country", saving || country.uppercase(Locale.ROOT) == preferences?.countryCode.orEmpty()) {
                    save(mapOf("country_code" to country.ifBlank { null }))
                }
            }

            notice?.let {
                Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            }
            error?.let {
                Text(it, color = theme.palette.accent, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            }

            Text(
                "Changing these settings never edits a transaction. Booked amounts keep their original currency and figure; only the converted totals and the review prompts change.",
                color = theme.palette.textSecondary,
                fontFamily = theme.fontFamily,
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun SettingsCard(content: @Composable ColumnScope.() -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s12),
        content = content,
    )
}

/** An expanding picker rather than a spinner, so no code is hidden behind a scroll. */
@Composable
private fun ChoiceRow(
    label: String,
    value: String,
    choices: List<String>,
    enabled: Boolean,
    display: (String) -> String,
    onSelect: (String) -> Unit,
) {
    val theme = LocalPersonalTheme.current
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(PersonalRadius.action))
                .background(theme.palette.canvas)
                .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.action))
                .clickable(enabled = enabled) { open = true }
                .padding(PersonalSpace.s12),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            Text(display(value), color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            choices.forEach { code ->
                DropdownMenuItem(
                    text = {
                        Text(display(code), fontFamily = theme.fontFamily, color = theme.palette.textPrimary)
                    },
                    onClick = {
                        open = false
                        onSelect(code)
                    },
                )
            }
        }
    }
}

@Composable
private fun SaveButton(label: String, disabled: Boolean, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(44.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(if (disabled) PersonalTokens.action.default.copy(alpha = 0.4f) else PersonalTokens.action.default)
            .clickable(enabled = !disabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = PersonalTokens.action.label,
            fontFamily = theme.fontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
        )
    }
}
