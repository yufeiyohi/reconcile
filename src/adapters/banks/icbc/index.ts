import { profiledAdapter } from "../../profiles";
export default profiledAdapter(
  "icbc",
  "工商银行",
  ["交易日期", "记账金额(收入)", "记账金额(支出)", "记账币种"],
  "工行采用记账金额与记账币种；交易地原币金额不合并。账户需由用户指定，不把对方账户当作本人账户。",
);
