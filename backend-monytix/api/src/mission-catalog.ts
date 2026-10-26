export type MissionFact = {
  title: string;
  category: string;
  basis: string;
  build: string;
  weights: string[];
  decisions: string[];
};

export const MISSION_FACTS: Record<string, MissionFact> = {
  "M01": {
    "title": "Build an Emergency Buffer",
    "category": "Build Safety",
    "basis": "Contribution + safety days",
    "build": "Savings / sweep / liquid reserve",
    "weights": [
      "Resilience",
      "Risk"
    ],
    "decisions": [
      "D1",
      "D17"
    ]
  },
  "M02": {
    "title": "Build an Income-Loss Buffer",
    "category": "Build Safety",
    "basis": "Runway months gained",
    "build": "Savings / deposit / liquid reserve",
    "weights": [
      "Resilience",
      "Risk"
    ],
    "decisions": [
      "D1",
      "D2"
    ]
  },
  "M03": {
    "title": "Build a Medical Reserve",
    "category": "Build Safety",
    "basis": "Reserve / target",
    "build": "Savings + health protection",
    "weights": [
      "Risk",
      "Resilience"
    ],
    "decisions": [
      "D1",
      "D2"
    ]
  },
  "M04": {
    "title": "Strengthen Insurance Protection",
    "category": "Build Safety",
    "basis": "Coverage-gap reduction",
    "build": "Health / term / accident / relevant cover",
    "weights": [
      "Risk",
      "Relationships"
    ],
    "decisions": [
      "D5",
      "D6"
    ]
  },
  "M05": {
    "title": "Prepare for an Unexpected Expense",
    "category": "Build Safety",
    "basis": "Contingency capacity",
    "build": "Liquid savings / reserve",
    "weights": [
      "Resilience",
      "Risk"
    ],
    "decisions": [
      "D2",
      "D12"
    ]
  },
  "M06": {
    "title": "Build 6-12 Months of Security",
    "category": "Build Safety",
    "basis": "Months expenses protected",
    "build": "Savings / deposits / liquid reserve",
    "weights": [
      "Resilience",
      "Risk"
    ],
    "decisions": [
      "D1",
      "D13",
      "D17"
    ]
  },
  "M07": {
    "title": "Clear Credit-Card Debt",
    "category": "Reduce Debt",
    "basis": "Principal reduction",
    "build": "Repayment / balance transfer / refinance",
    "weights": [
      "Obligations",
      "Risk"
    ],
    "decisions": [
      "D3"
    ]
  },
  "M08": {
    "title": "Pay Off a Personal Loan Faster",
    "category": "Reduce Debt",
    "basis": "Principal + tenure reduction",
    "build": "Prepayment / refinance",
    "weights": [
      "Obligations",
      "Risk"
    ],
    "decisions": [
      "D4"
    ]
  },
  "M09": {
    "title": "Reduce Home-Loan Burden",
    "category": "Reduce Debt",
    "basis": "Principal/tenure/interest impact",
    "build": "Prepayment / refinance",
    "weights": [
      "Obligations",
      "Risk"
    ],
    "decisions": [
      "D4"
    ]
  },
  "M10": {
    "title": "Reduce EMI Pressure",
    "category": "Reduce Debt",
    "basis": "EMI/inflow burden reduction",
    "build": "Restructure / refinance / reserve",
    "weights": [
      "Obligations",
      "Resilience"
    ],
    "decisions": [
      "D4",
      "D12"
    ]
  },
  "M11": {
    "title": "Cut Recurring Commitments",
    "category": "Reduce Debt",
    "basis": "Recurring monthly reduction",
    "build": "Cancellation / downgrade",
    "weights": [
      "Obligations",
      "Attention"
    ],
    "decisions": [
      "D9"
    ]
  },
  "M12": {
    "title": "Become Debt-Free",
    "category": "Reduce Debt",
    "basis": "Total qualifying debt reduction",
    "build": "Repayment / refinance",
    "weights": [
      "Obligations",
      "Resilience"
    ],
    "decisions": [
      "D3",
      "D4"
    ]
  },
  "M13": {
    "title": "Build a Home Fund",
    "category": "Save for Something",
    "basis": "Fund / target",
    "build": "Savings / deposits / investment / home finance later",
    "weights": [
      "Legacy",
      "Opportunity"
    ],
    "decisions": [
      "D14",
      "D22"
    ]
  },
  "M14": {
    "title": "Save for a Vehicle",
    "category": "Save for Something",
    "basis": "Fund / target",
    "build": "Savings / deposit / vehicle finance later",
    "weights": [
      "Opportunity",
      "Comfort"
    ],
    "decisions": [
      "D11",
      "D14"
    ]
  },
  "M15": {
    "title": "Build an Education Fund",
    "category": "Save for Something",
    "basis": "Corpus / target",
    "build": "Savings / investment",
    "weights": [
      "Legacy",
      "Relationships"
    ],
    "decisions": [
      "D14",
      "D22"
    ]
  },
  "M16": {
    "title": "Save for a Wedding",
    "category": "Save for Something",
    "basis": "Fund / target",
    "build": "Savings / deposit / investment",
    "weights": [
      "Relationships",
      "Time"
    ],
    "decisions": [
      "D11",
      "D14"
    ]
  },
  "M17": {
    "title": "Build a Travel Fund",
    "category": "Save for Something",
    "basis": "Fund / planned need",
    "build": "Savings / travel fund",
    "weights": [
      "Opportunity",
      "Comfort"
    ],
    "decisions": [
      "D14",
      "D26"
    ]
  },
  "M18": {
    "title": "Fund a Major Purchase",
    "category": "Save for Something",
    "basis": "Fund / expected cost",
    "build": "Savings / appropriate finance later",
    "weights": [
      "Comfort",
      "Opportunity"
    ],
    "decisions": [
      "D11",
      "D14"
    ]
  },
  "M19": {
    "title": "Start Investing Regularly",
    "category": "Build Wealth",
    "basis": "Contribution frequency",
    "build": "Mutual fund SIP / recurring investment",
    "weights": [
      "Opportunity",
      "Legacy"
    ],
    "decisions": [
      "D18",
      "D19"
    ]
  },
  "M20": {
    "title": "Increase My SIP",
    "category": "Build Wealth",
    "basis": "Incremental contribution rate",
    "build": "Mutual fund SIP",
    "weights": [
      "Opportunity",
      "Legacy"
    ],
    "decisions": [
      "D18"
    ]
  },
  "M21": {
    "title": "Put Idle Cash to Work",
    "category": "Build Wealth",
    "basis": "Eligible idle cash deployed",
    "build": "Deposit / liquid fund / investment",
    "weights": [
      "Opportunity",
      "Resilience"
    ],
    "decisions": [
      "D7",
      "D19"
    ]
  },
  "M22": {
    "title": "Build a Long-Term Corpus",
    "category": "Build Wealth",
    "basis": "Contributions/corpus vs target",
    "build": "Investment / deposits",
    "weights": [
      "Legacy",
      "Opportunity"
    ],
    "decisions": [
      "D18",
      "D22"
    ]
  },
  "M23": {
    "title": "Keep My Portfolio Balanced",
    "category": "Build Wealth",
    "basis": "Drift restored",
    "build": "Portfolio rebalance",
    "weights": [
      "Risk",
      "Opportunity"
    ],
    "decisions": [
      "D20"
    ]
  },
  "M24": {
    "title": "Build My Retirement Corpus",
    "category": "Build Wealth",
    "basis": "Funding trajectory",
    "build": "Retirement / pension / investment",
    "weights": [
      "Legacy",
      "Time"
    ],
    "decisions": [
      "D21",
      "D22"
    ]
  },
  "M25": {
    "title": "Reduce Dining Spend",
    "category": "Improve Spending",
    "basis": "Contextual spend reduction",
    "build": "None normally",
    "weights": [
      "Comfort",
      "Attention"
    ],
    "decisions": [
      "D23"
    ]
  },
  "M26": {
    "title": "Control Shopping Spend",
    "category": "Improve Spending",
    "basis": "Spend vs baseline/limit",
    "build": "None normally",
    "weights": [
      "Comfort",
      "Identity"
    ],
    "decisions": [
      "D24"
    ]
  },
  "M27": {
    "title": "Reduce Entertainment Spend",
    "category": "Improve Spending",
    "basis": "Spend vs baseline",
    "build": "None normally",
    "weights": [
      "Comfort",
      "Attention"
    ],
    "decisions": [
      "D25"
    ]
  },
  "M28": {
    "title": "Keep Travel Spending Under Control",
    "category": "Improve Spending",
    "basis": "Actual vs contextual plan",
    "build": "Travel fund / payment solution later",
    "weights": [
      "Comfort",
      "Attention"
    ],
    "decisions": [
      "D26"
    ]
  },
  "M29": {
    "title": "Reduce Discretionary Spending",
    "category": "Improve Spending",
    "basis": "Discretionary/flexible-income ratio",
    "build": "None; redirect released cash",
    "weights": [
      "Comfort",
      "Attention"
    ],
    "decisions": [
      "D27"
    ]
  },
  "M30": {
    "title": "Stop Financial Leakage",
    "category": "Improve Spending",
    "basis": "Identified leakage eliminated",
    "build": "Cancellation / cheaper plan",
    "weights": [
      "Attention",
      "Obligations"
    ],
    "decisions": [
      "D9",
      "D10"
    ]
  },
  "M31": {
    "title": "Allocate My Salary Better",
    "category": "Improve Cash Flow",
    "basis": "Productive allocation ratio",
    "build": "Savings / debt / SIP / goal allocation",
    "weights": [
      "Attention",
      "Opportunity"
    ],
    "decisions": [
      "D15"
    ]
  },
  "M32": {
    "title": "Put Monthly Surplus to Work",
    "category": "Improve Cash Flow",
    "basis": "Percent surplus allocated",
    "build": "Savings / debt / deposit / investment",
    "weights": [
      "Opportunity",
      "Comfort"
    ],
    "decisions": [
      "D8"
    ]
  },
  "M33": {
    "title": "Avoid a Cash Crunch",
    "category": "Improve Cash Flow",
    "basis": "Forecast shortfalls avoided",
    "build": "Reserve / short-term liquidity",
    "weights": [
      "Resilience",
      "Risk"
    ],
    "decisions": [
      "D12"
    ]
  },
  "M34": {
    "title": "Prepare for a Large Upcoming Expense",
    "category": "Improve Cash Flow",
    "basis": "Pre-funded / requirement",
    "build": "Savings / deposit / goal funding",
    "weights": [
      "Time",
      "Risk"
    ],
    "decisions": [
      "D11"
    ]
  },
  "M35": {
    "title": "Use a Bonus or Windfall Better",
    "category": "Improve Cash Flow",
    "basis": "Productive allocation percent",
    "build": "Debt / reserve / deposit / investment",
    "weights": [
      "Opportunity",
      "Legacy"
    ],
    "decisions": [
      "D16"
    ]
  },
  "M36": {
    "title": "Increase My Savings Rate",
    "category": "Improve Cash Flow",
    "basis": "Savings-rate improvement",
    "build": "Savings / deposit / investment",
    "weights": [
      "Resilience",
      "Opportunity"
    ],
    "decisions": [
      "D13"
    ]
  },
  "M37": {
    "title": "Build a Fund for My Children",
    "category": "Support Life & Family",
    "basis": "Corpus / target",
    "build": "Savings / investment",
    "weights": [
      "Relationships",
      "Legacy"
    ],
    "decisions": [
      "D14",
      "D22"
    ]
  },
  "M38": {
    "title": "Support My Parents",
    "category": "Support Life & Family",
    "basis": "Planned support capacity",
    "build": "Savings / protection",
    "weights": [
      "Relationships",
      "Obligations"
    ],
    "decisions": [
      "D11",
      "D14"
    ]
  },
  "M39": {
    "title": "Prepare for Family Healthcare",
    "category": "Support Life & Family",
    "basis": "Reserve + protection gap",
    "build": "Health insurance / reserve",
    "weights": [
      "Relationships",
      "Risk"
    ],
    "decisions": [
      "D6",
      "D11"
    ]
  },
  "M40": {
    "title": "Prepare for Family Education",
    "category": "Support Life & Family",
    "basis": "Corpus / requirement",
    "build": "Savings / investment",
    "weights": [
      "Relationships",
      "Legacy"
    ],
    "decisions": [
      "D14",
      "D22"
    ]
  },
  "M41": {
    "title": "Build a Family Safety Net",
    "category": "Support Life & Family",
    "basis": "Protection months/coverage",
    "build": "Insurance + liquid reserve",
    "weights": [
      "Relationships",
      "Resilience"
    ],
    "decisions": [
      "D1",
      "D6"
    ]
  },
  "M42": {
    "title": "Prepare for a Family Milestone",
    "category": "Support Life & Family",
    "basis": "Funded amount / requirement",
    "build": "Savings / investment",
    "weights": [
      "Relationships",
      "Time"
    ],
    "decisions": [
      "D11",
      "D14"
    ]
  },
  "M43": {
    "title": "Prepare for a Career Break",
    "category": "Create Freedom",
    "basis": "Funded runway months",
    "build": "Liquid reserve / investment corpus",
    "weights": [
      "Time",
      "Resilience"
    ],
    "decisions": [
      "D14",
      "D21"
    ]
  },
  "M44": {
    "title": "Prepare to Start a Business",
    "category": "Create Freedom",
    "basis": "Runway target",
    "build": "Savings / investment / business finance later",
    "weights": [
      "Opportunity",
      "Resilience"
    ],
    "decisions": [
      "D14",
      "D22"
    ]
  },
  "M45": {
    "title": "Prepare to Relocate",
    "category": "Create Freedom",
    "basis": "Fund / transition cost",
    "build": "Savings / liquidity",
    "weights": [
      "Opportunity",
      "Time"
    ],
    "decisions": [
      "D11",
      "D14"
    ]
  },
  "M46": {
    "title": "Work Toward Financial Independence",
    "category": "Create Freedom",
    "basis": "Sustainable capacity trajectory",
    "build": "Investment / retirement solutions",
    "weights": [
      "Legacy",
      "Opportunity"
    ],
    "decisions": [
      "D21"
    ]
  },
  "M47": {
    "title": "Retire Earlier",
    "category": "Create Freedom",
    "basis": "Time-to-goal reduction",
    "build": "Retirement / pension / investment",
    "weights": [
      "Time",
      "Legacy"
    ],
    "decisions": [
      "D21",
      "D22"
    ]
  },
  "M48": {
    "title": "Build More Financial Flexibility",
    "category": "Create Freedom",
    "basis": "Flexible resources vs obligations",
    "build": "Savings / investment",
    "weights": [
      "Opportunity",
      "Resilience"
    ],
    "decisions": [
      "D2",
      "D8",
      "D13"
    ]
  }
};
