# 依赖与许可证

精确版本与完整性摘要由 package-lock.json 固定，使用 npm ci 重现安装。

| 运行依赖          | 锁定版本 | 许可证     |
| ----------------- | -------- | ---------- |
| @e965/xlsx        | 0.20.3   | Apache-2.0 |
| @thednp/dommatrix | 3.1.2    | MIT        |
| fflate            | 0.8.3    | MIT        |
| papaparse         | 5.7.0    | MIT        |
| pdfjs-dist        | 6.4.299  | Apache-2.0 |
| react             | 19.3.0   | MIT        |
| react-dom         | 19.3.0   | MIT        |
| read-excel-file   | 9.3.12   | MIT        |

Papa Parse 读取 CSV；read-excel-file 读取 XLSX，fflate 用于解压资源核验；PDF.js 读取文本 PDF，DOMMatrix shim 用于 Worker。SheetJS CE 读取 BIFF XLS，使用 @e965/xlsx npm 镜像包，非官方 npm 发布，也不是 npm 上旧版 xlsx。升级时应重新审查来源与版本。

上游：[Papa Parse](https://github.com/mholt/PapaParse)、[read-excel-file](https://github.com/catamphetamine/read-excel-file)、[fflate](https://github.com/101arrowz/fflate)、[PDF.js](https://github.com/mozilla/pdf.js)、[SheetJS CE](https://git.sheetjs.com/sheetjs/sheetjs)、[DOMMatrix](https://github.com/thednp/dommatrix)。

React / React DOM 为 MIT；开发工具 TypeScript 为 Apache-2.0，Vite / Vitest 为 MIT，Playwright 为 Apache-2.0。所有版本都在锁文件中记录。

项目 MIT 许可证不改变第三方许可证。运行依赖许可证保留在 [THIRD-PARTY-NOTICES](../THIRD-PARTY-NOTICES.txt)。审计不等于绝对安全；更新依赖后应重新运行测试和审计。
