package com.monytix.app.shell

import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * Currency-aware money rendering.
 *
 * Every ledger row carries its own `currency`, and `ref.currency` carries the minor
 * units for it. Nothing here may assume rupees: no `Locale.US`, no `"%,.2f"`, and no
 * hard-coded `₹`.
 *
 * The two rules that keep it honest:
 *
 *  1. **The code comes from the data.** [currency] resolves the row's own code first,
 *     then the account's, then the owner's home currency. There is no default constant.
 *  2. **The locale comes from the platform.** [NumberFormat.getCurrencyInstance] already
 *     knows `en_IN` groups by lakh and `de_DE` writes `1.234,56 €`, so the app never
 *     slices digits itself.
 *
 * Amounts arrive as decimal strings because `numeric(20,4)` does not fit a `Double`
 * without losing paise; [parse] keeps that exactness in [BigDecimal].
 */
object Money {
    /** The currency to render a row in, from the row, its account, or the owner's home. */
    fun currency(row: String?, account: String? = null, home: String? = null): String? {
        for (candidate in listOf(row, account, home)) {
            val code = candidate?.trim()?.uppercase(Locale.ROOT).orEmpty()
            if (code.length == 3 && code.all { it in 'A'..'Z' }) return code
        }
        return null
    }

    /** An exact decimal from an API amount string. `null` rather than a guess. */
    fun parse(raw: String?): BigDecimal? {
        val text = raw?.trim()?.replace("\u00A0", "")?.replace("\u202F", "")?.replace(",", "")
        if (text.isNullOrEmpty()) return null
        return runCatching { BigDecimal(text) }.getOrNull()
    }

    /**
     * A currency formatter at the device's locale.
     *
     * [minorUnits] comes from `ref.currency` when the bootstrap shipped it. Without it
     * the formatter uses the code's own default, which is right for every currency the
     * server can detect; passing it explicitly only matters for a code the device's
     * CLDR data predates.
     */
    fun formatter(
        currency: String?,
        locale: Locale = Locale.getDefault(),
        minorUnits: Int? = null,
        maximumFractionDigits: Int? = null,
    ): NumberFormat {
        val format = NumberFormat.getCurrencyInstance(locale)
        if (!currency.isNullOrBlank()) {
            runCatching { format.currency = Currency.getInstance(currency) }
        }
        if (minorUnits != null) {
            format.minimumFractionDigits = minorUnits
        }
        if (maximumFractionDigits != null) {
            format.maximumFractionDigits = maximumFractionDigits
            if (format.minimumFractionDigits > maximumFractionDigits) {
                format.minimumFractionDigits = maximumFractionDigits
            }
        }
        return format
    }

    /** `₹1,180.00`, `$14.00`, `1.234,56 €`. Falls back to `CODE amount`, never to a glyph guess. */
    fun format(
        amount: BigDecimal,
        currency: String?,
        locale: Locale = Locale.getDefault(),
        minorUnits: Int? = null,
        maximumFractionDigits: Int? = null,
    ): String {
        val text = runCatching {
            formatter(currency, locale, minorUnits, maximumFractionDigits).format(amount)
        }.getOrNull()
        if (text != null) return text
        // No glyph and no CLDR entry: the ISO code is the honest fallback.
        val plain = NumberFormat.getNumberInstance(locale)
        plain.minimumFractionDigits = minorUnits ?: 2
        plain.maximumFractionDigits = maximumFractionDigits ?: (minorUnits ?: 2)
        val bare = runCatching { plain.format(amount) }.getOrNull() ?: amount.toPlainString()
        return if (currency.isNullOrBlank()) bare else "$currency $bare"
    }

    /** A string amount direct from the API, so call sites do not each parse. */
    fun format(
        raw: String?,
        currency: String?,
        locale: Locale = Locale.getDefault(),
        minorUnits: Int? = null,
        maximumFractionDigits: Int? = null,
        fallback: String = "Not recorded",
    ): String {
        val amount = parse(raw) ?: return if (raw.isNullOrBlank()) fallback else raw
        return format(amount, currency, locale, minorUnits, maximumFractionDigits)
    }

    /**
     * A compact figure for a card heading: `₹1.8L`, `$14.2k`.
     *
     * The scale word follows the currency's own grouping. Rupees group by lakh, so
     * `L`/`Cr` is right for INR and wrong for USD, which is why this decides from the
     * code rather than from the locale.
     */
    fun compact(amount: BigDecimal, currency: String?, locale: Locale = Locale.getDefault()): String {
        val magnitude = amount.abs()
        val lakhStyle = currency?.uppercase(Locale.ROOT) == "INR"
        val divisor: BigDecimal
        val suffix: String
        if (lakhStyle) {
            when {
                magnitude >= BigDecimal(10_000_000) -> { divisor = BigDecimal(10_000_000); suffix = "Cr" }
                magnitude >= BigDecimal(100_000) -> { divisor = BigDecimal(100_000); suffix = "L" }
                magnitude >= BigDecimal(1_000) -> { divisor = BigDecimal(1_000); suffix = "k" }
                else -> return format(amount, currency, locale)
            }
        } else {
            when {
                magnitude >= BigDecimal(1_000_000_000) -> { divisor = BigDecimal(1_000_000_000); suffix = "B" }
                magnitude >= BigDecimal(1_000_000) -> { divisor = BigDecimal(1_000_000); suffix = "M" }
                magnitude >= BigDecimal(1_000) -> { divisor = BigDecimal(1_000); suffix = "k" }
                else -> return format(amount, currency, locale)
            }
        }
        val scaled = amount.divide(divisor, 1, java.math.RoundingMode.HALF_UP)
        return format(scaled, currency, locale, maximumFractionDigits = 1) + suffix
    }
}

/** `preferences` inside `/v1/ui/bootstrap`. Mirrors `OwnerPreferences` on the API. */
data class OwnerPreferences(
    val defaultCurrencyCode: String,
    val timezoneName: String,
    val countryCode: String?,
    val locale: String?,
) {
    /** The [Locale] money should be formatted with: the owner's own before the device's. */
    val moneyLocale: Locale
        get() = if (locale.isNullOrBlank()) Locale.getDefault() else Locale.forLanguageTag(locale)

    companion object {
        fun from(json: org.json.JSONObject?): OwnerPreferences? {
            if (json == null) return null
            val currency = json.optString("defaultCurrencyCode").orEmpty().uppercase(Locale.ROOT)
            if (currency.length != 3) return null
            return OwnerPreferences(
                defaultCurrencyCode = currency,
                timezoneName = json.optString("timezoneName").ifBlank { "UTC" },
                countryCode = json.optString("countryCode").takeIf { it.isNotBlank() }?.uppercase(Locale.ROOT),
                locale = json.optString("locale").takeIf { it.isNotBlank() },
            )
        }
    }
}

/** One row of `ref.currency`, so a code the device has no CLDR row for still renders. */
data class CurrencyFormat(
    val code: String,
    val displayName: String?,
    val symbol: String?,
    val minorUnits: Int?,
    val monetary: Boolean,
) {
    companion object {
        fun from(code: String, json: org.json.JSONObject?): CurrencyFormat? {
            if (json == null) return null
            return CurrencyFormat(
                code = json.optString("code").ifBlank { code }.uppercase(Locale.ROOT),
                displayName = json.optString("displayName").takeIf { it.isNotBlank() },
                symbol = json.optString("symbol").takeIf { it.isNotBlank() },
                minorUnits = if (json.has("minorUnits")) json.optInt("minorUnits") else null,
                monetary = !json.has("monetary") || json.optBoolean("monetary"),
            )
        }
    }
}
