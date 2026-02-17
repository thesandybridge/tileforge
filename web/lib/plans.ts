export const PLAN_FREE = "free" as const;
export const PLAN_PRO = "pro" as const;

export type Plan = typeof PLAN_FREE | typeof PLAN_PRO;
