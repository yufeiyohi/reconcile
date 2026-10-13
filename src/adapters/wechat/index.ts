import { profiledAdapter } from "../profiles";
export default profiledAdapter(
  "wechat",
  "微信支付",
  ["交易时间", "收/支", "金额(元)", "交易单号"],
  "微信支付是支付渠道，可能与银行卡流水重叠；按“微支付”账本单独核对，不把跨渠道合计视为消费总额。原消费与退款记录分别保留，退款状态不直接删除原消费；无法识别的“不计收支”行进入错误列表。",
);
