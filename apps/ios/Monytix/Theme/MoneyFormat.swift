import Foundation

/// Currency-aware money rendering.
///
/// The ledger already stores a `currency` on every row and a `ref.currency` row for
/// every code it can hold. Nothing in the app should therefore write `₹`, or set
/// `currencyCode = "INR"`, or reach for `Locale(identifier: "en_IN")`: the booked
/// currency decides the code and the owner's locale decides the separators.
///
/// Two rules keep this honest:
///
/// 1. **The code comes from the data.** `Money.currency` is the row's currency, the
///    account's currency or the owner's home currency, in that order. There is no
///    default constant here.
/// 2. **The locale comes from the device.** `NumberFormatter` with a `.currency`
///    style already knows that `en_IN` groups by lakh and `de_DE` writes `1.234,56 €`.
///    No custom digit slicing, and no forcing a locale onto another one's number.
///
/// Amounts arrive from the API as decimal strings because `numeric(20,4)` does not fit
/// a `Double` without losing paise. `Money.parse` keeps that precision by parsing to
/// `Decimal`; `format` only rounds at presentation.
enum Money {
    /// The currency to use for a row, given everything the app knows about it.
    ///
    /// A row's own currency always wins: an INR row inside a USD-converted report is
    /// still an INR row, and showing it as USD would be a lie about the ledger.
    static func currency(row: String?, account: String?, home: String?) -> String? {
        for candidate in [row, account, home] {
            let code = candidate?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() ?? ""
            if code.count == 3, code.allSatisfy({ $0.isLetter }) {
                return code
            }
        }
        return nil
    }

    /// An exact decimal from an API amount string, which may carry thin spaces,
    /// non-breaking spaces, or a leading sign. Returns nil rather than guessing.
    static func parse(_ raw: String?) -> Decimal? {
        guard var text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            return nil
        }
        // An API amount is machine-formatted (`1234.5600`); a human-formatted string can
        // still arrive from a decision copy, so strip the separators the server never emits.
        text = text.replacingOccurrences(of: "\u{00A0}", with: "")
        text = text.replacingOccurrences(of: "\u{202F}", with: "")
        text = text.replacingOccurrences(of: ",", with: "")
        return Decimal(string: text, locale: Locale(identifier: "en_US_POSIX"))
    }

    /// The formatter for a currency, at the device's locale.
    ///
    /// `minorUnits` comes from `ref.currency` when the bootstrap shipped it. Without it
    /// the formatter uses the code's own default, which is correct for every currency
    /// the server can detect; passing it explicitly only matters for a code the device's
    /// CLDR data predates.
    static func formatter(
        currency: String?,
        locale: Locale = .current,
        minorUnits: Int? = nil,
        maximumFractionDigits: Int? = nil
    ) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = locale
        if let currency, !currency.isEmpty {
            formatter.currencyCode = currency
        }
        if let minorUnits {
            formatter.minimumFractionDigits = minorUnits
        }
        if let maximumFractionDigits {
            formatter.maximumFractionDigits = maximumFractionDigits
            // Never show fewer decimals than the currency itself has.
            formatter.minimumFractionDigits = min(formatter.minimumFractionDigits, maximumFractionDigits)
        }
        return formatter
    }

    /// `₹1,180.00`, `$14.00`, `1.234,56 €`. Falls back to a bare `CODE amount` when the
    /// formatter has no glyph for the code, which is still unambiguous.
    static func format(
        _ amount: Decimal,
        currency: String?,
        locale: Locale = .current,
        minorUnits: Int? = nil,
        maximumFractionDigits: Int? = nil
    ) -> String {
        let formatter = formatter(
            currency: currency,
            locale: locale,
            minorUnits: minorUnits,
            maximumFractionDigits: maximumFractionDigits
        )
        let number = NSDecimalNumber(decimal: amount)
        if let text = formatter.string(from: number) {
            return text
        }
        // No glyph and no CLDR entry: the ISO code is the honest fallback.
        let plain = NumberFormatter()
        plain.numberStyle = .decimal
        plain.locale = locale
        plain.minimumFractionDigits = minorUnits ?? 2
        plain.maximumFractionDigits = maximumFractionDigits ?? (minorUnits ?? 2)
        let text = plain.string(from: number) ?? "\(amount)"
        guard let currency, !currency.isEmpty else { return text }
        return "\(currency) \(text)"
    }

    /// A string amount direct from the API, so call sites do not each parse.
    static func format(
        raw: String?,
        currency: String?,
        locale: Locale = .current,
        minorUnits: Int? = nil,
        maximumFractionDigits: Int? = nil
    ) -> String {
        guard let amount = parse(raw) else {
            return raw?.isEmpty == false ? (raw ?? "") : "Not recorded"
        }
        return format(
            amount,
            currency: currency,
            locale: locale,
            minorUnits: minorUnits,
            maximumFractionDigits: maximumFractionDigits
        )
    }

    /// A compact figure for a card heading: `₹1.8L`, `$14.2k`.
    ///
    /// The scale word is chosen by the currency's own grouping, not by `en_IN`. Rupees
    /// group by lakh, so `L`/`Cr` is right for INR and wrong for USD; the dollar path
    /// uses `k`/`M`/`B`.
    static func compact(
        _ amount: Decimal,
        currency: String?,
        locale: Locale = .current
    ) -> String {
        let value = NSDecimalNumber(decimal: amount).doubleValue
        let magnitude = abs(value)
        let lakhStyle = currency?.uppercased() == "INR"
        let divider: Double
        let suffix: String
        if lakhStyle {
            switch magnitude {
            case 10_000_000...: divider = 10_000_000; suffix = "Cr"
            case 100_000...: divider = 100_000; suffix = "L"
            case 1_000...: divider = 1_000; suffix = "k"
            default: return format(amount, currency: currency, locale: locale)
            }
        } else {
            switch magnitude {
            case 1_000_000_000...: divider = 1_000_000_000; suffix = "B"
            case 1_000_000...: divider = 1_000_000; suffix = "M"
            case 1_000...: divider = 1_000; suffix = "k"
            default: return format(amount, currency: currency, locale: locale)
            }
        }
        let scaled = value / divider
        return format(Decimal(scaled), currency: currency, locale: locale, maximumFractionDigits: 1) + suffix
    }
}

/// The bootstrap's `currency_formats` block, keyed by ISO code.
///
/// Present so the app can format a code the device has no CLDR row for. Every lookup
/// is optional: a missing entry simply means "use the platform's own default".
struct CurrencyFormat: Decodable, Equatable {
    let code: String
    let displayName: String?
    let symbol: String?
    let minorUnits: Int?
    let monetary: Bool?

    enum CodingKeys: String, CodingKey {
        case code
        case displayName
        case symbol
        case minorUnits
        case monetary
    }

    init(code: String, displayName: String?, symbol: String?, minorUnits: Int?, monetary: Bool?) {
        self.code = code
        self.displayName = displayName
        self.symbol = symbol
        self.minorUnits = minorUnits
        self.monetary = monetary
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        code = (try? container.decode(String.self, forKey: .code)) ?? ""
        displayName = try? container.decodeIfPresent(String.self, forKey: .displayName)
        symbol = try? container.decodeIfPresent(String.self, forKey: .symbol)
        minorUnits = try? container.decodeIfPresent(Int.self, forKey: .minorUnits)
        monetary = try? container.decodeIfPresent(Bool.self, forKey: .monetary)
    }
}
