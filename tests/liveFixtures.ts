/**
 * Texts for the opt-in live accuracy check (DECISIONS.md D37). All are
 * original and fictitious, because the check sends them to Anthropic.
 *
 * Each is at least 200 o200k tokens, so ±12% is dozens of tokens and neither
 * rounding nor the message wrapper decides a pass. CJK and SQL are here
 * because they were the low and high ends of the ratios measured for D36:
 * don't drop a content type because it fails.
 */
export const LIVE_FIXTURES: Array<{ name: string; text: string }> = [
  {
    name: "prose",
    text: `You are the support assistant for a small company that rents camera equipment to independent film crews. Most of the people who write to you are in the middle of planning a shoot, so they care about dates, availability and what happens when something goes wrong. Answer the question they asked before you offer anything else, and keep your tone calm and practical.

When a customer reports damaged equipment, first find out whether anyone was hurt and whether the gear is still safe to use. Then ask for the booking reference, a short description of what happened and photographs if they have them. Do not estimate a repair cost. The workshop inspects every returned item and sends a written quote within three working days. If the damage happened during transport by our courier, tell the customer that they will not be charged and that a colleague will follow up with the courier directly.

When a customer wants to extend a booking, remember that the same kit may already be promised to another crew. Never confirm an extension yourself. Collect the new return date, explain that the bookings team replies within two hours during opening times, and mention that late returns without an approved extension are billed at the normal daily rate. Crews who are filming overseas often write outside those hours, so acknowledge the time difference and tell them plainly when they can expect an answer.

If you are unsure, say what you do not know and hand the conversation to a person. A clear handover with the facts already gathered is more useful than a confident guess, and it saves the customer from telling the same story twice.
`,
  },
  {
    name: "code",
    text: `export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
};

function computeBackoff(attempt: number, options: RetryOptions): number {
  const exponential = options.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, options.maxDelayMs);
  // Full jitter keeps a fleet of clients from retrying in lockstep.
  return Math.floor(Math.random() * capped);
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  overrides: Partial<RetryOptions> = {},
): Promise<T> {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const exhausted = attempt === options.maxAttempts;
      if (exhausted || options.shouldRetry?.(error, attempt) === false) {
        break;
      }
      const delayMs = computeBackoff(attempt, options);
      options.onRetry?.(error, attempt, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
`,
  },
  {
    name: "json",
    text: `{
  "order_id": "ord_demo_10482",
  "status": "partially_shipped",
  "created_at": "2026-03-14T09:26:53Z",
  "currency": "SGD",
  "customer": {
    "id": "cus_demo_2207",
    "segment": "small_business",
    "locale": "en-SG",
    "marketing_opt_in": false
  },
  "line_items": [
    {"sku": "DESK-OAK-140", "description": "Oak standing desk, 140 cm", "quantity": 2, "unit_price": 689.00, "tax_rate": 0.09, "fulfilment": "shipped"},
    {"sku": "CHAIR-MESH-BLK", "description": "Mesh task chair, black", "quantity": 4, "unit_price": 245.50, "tax_rate": 0.09, "fulfilment": "backordered"},
    {"sku": "ARM-DUAL-27", "description": "Dual monitor arm, up to 27 inch", "quantity": 2, "unit_price": 119.90, "tax_rate": 0.09, "fulfilment": "shipped"}
  ],
  "shipments": [
    {
      "id": "shp_demo_5531",
      "carrier": "example_freight",
      "service_level": "standard",
      "estimated_delivery": "2026-03-19",
      "events": [
        {"at": "2026-03-15T02:10:00Z", "code": "picked_up", "location": "Warehouse A"},
        {"at": "2026-03-16T11:42:00Z", "code": "in_transit", "location": "Central hub"}
      ]
    }
  ],
  "discounts": [{"code": "WELCOME10", "type": "percentage", "value": 10, "applies_to": ["DESK-OAK-140"]}],
  "notes": null
}
`,
  },
  {
    name: "cjk",
    text: `你是一家社区图书馆的咨询助手。读者通常会询问借书期限、续借方法、活动报名以及如何寻找某一类书籍。请先直接回答问题，再补充必要的说明。普通图书可以借阅三周，如果没有其他读者预约，可以在线续借一次。参考书和当期杂志只能在馆内阅读。遇到账户被锁定或者罚款有争议的情况，不要自行处理，请记录读者的问题，并转交给服务台的工作人员。

あなたは地域の図書館の案内係です。利用者から質問を受けたら、まず結論を短く伝え、そのあとで理由や手続きを説明してください。予約した本は、到着の連絡から七日間カウンターで取り置きします。期限を過ぎると次の人に回るため、受け取りが難しい場合は早めに相談するよう伝えてください。分からないことは推測せず、職員に確認すると答えてください。

당신은 동네 도서관의 안내 도우미입니다. 어린이 프로그램은 매주 토요일 오전에 열리며, 참가 신청은 행사 이틀 전까지 받습니다. 보호자가 함께 와야 하는 프로그램인지 먼저 확인하고, 정원이 찼다면 대기자 명단에 등록하는 방법을 알려 주세요. 개인정보는 꼭 필요한 경우가 아니면 요청하지 마세요.
`,
  },
  {
    name: "sql",
    text: `WITH monthly_usage AS (
  SELECT
    u.account_id,
    DATE_TRUNC('month', u.occurred_at) AS usage_month,
    SUM(u.input_tokens) AS input_tokens,
    SUM(u.output_tokens) AS output_tokens,
    COUNT(DISTINCT u.conversation_id) AS conversation_count
  FROM usage_events AS u
  WHERE u.occurred_at >= DATE '2026-01-01'
    AND u.occurred_at < DATE '2026-07-01'
    AND u.is_internal_test = FALSE
  GROUP BY u.account_id, DATE_TRUNC('month', u.occurred_at)
),
priced AS (
  SELECT
    m.account_id,
    m.usage_month,
    m.conversation_count,
    (m.input_tokens * p.input_usd_per_mtok + m.output_tokens * p.output_usd_per_mtok) / 1000000.0 AS cost_usd
  FROM monthly_usage AS m
  JOIN account_plans AS a ON a.account_id = m.account_id
  JOIN price_snapshots AS p ON p.model_id = a.default_model_id
    AND m.usage_month >= p.valid_from
    AND (p.valid_to IS NULL OR m.usage_month < p.valid_to)
)
SELECT
  account_id,
  usage_month,
  ROUND(cost_usd, 2) AS cost_usd,
  ROUND(cost_usd / NULLIF(conversation_count, 0), 4) AS cost_per_conversation,
  LAG(cost_usd) OVER (PARTITION BY account_id ORDER BY usage_month) AS previous_month_cost,
  RANK() OVER (PARTITION BY usage_month ORDER BY cost_usd DESC) AS spend_rank
FROM priced
ORDER BY usage_month DESC, spend_rank ASC;
`,
  },
];
