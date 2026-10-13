import { profiledAdapter } from "../../profiles";
export default profiledAdapter(
  "cmb",
  "招商银行借记卡",
  ["交易日期", "收入", "支出", "交易备注"],
  "招行借记卡采用独立收入 / 支出列；YYYYMMDD 按业务日期读取。账户需用户明确指定。",
);
