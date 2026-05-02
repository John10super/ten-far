# FAR — Financial Analysis Report 工作紀錄

> **工具名稱：** TEN Consultancy — Financial Health Analysis  
> **GitHub Pages：** https://john10super.github.io/ten-far/  
> **主源文件：** `📤 Serena 輸出/03 簡報/FAR-v4.html`  
> **GitHub Repo：** `/Users/ten/ten-far/index.html`  
> **最後更新：** 02/05/2026（v4.13）

---

## 📐 工具概述

FAR 是一個完全在瀏覽器運行的財務健康分析工具，供 TEN Consultancy 顧問用於客戶保障缺口分析。  
三語言支援（中文 / English / BM），可直接列印成 PDF 報告。

### 功能架構

| 章節 | 內容 |
|------|------|
| 顧問資訊 | 顧問姓名/聯絡/Email、報告日期 |
| 個人資料 | 客戶姓名、IC號碼（自動算年齡）、聯絡、職業、年齡、配偶、撫養人 |
| 財務狀況 | 月收入、生活開銷、房貸/辦公室貸款、投資房產、車貸/信用卡 |
| 計算假設 | 通脹率（預設3.69%）、利率（預設2.5%）、IDE、RRF |
| 現有保單 | 最多10份人壽/TPD/CI/PA/殘障收入保單；最多5份醫療卡 |
| 財務摘要 | 月收入/支出/現金流/總債務 KPI 卡 |
| 保險需求分析 | 所需保障 vs 現有保障 vs 缺口（死亡/TPD/CI）|
| 風險比率分析 | 14個風險指標（Cover Ratio, DTF, DBF, IFS, CI等）|
| 保障缺口總覽 | Before vs After 對比表格 |
| 醫療保障分析 | 病房費/終身限額/MHI覆蓋率 KPI 卡 |
| 建議方案 | 自動生成保障缺口優先行動建議 |
| 行動計劃 | P1/P2/P3 優先級行動表格 |

### 核心計算邏輯

```
實際利率 = (利率 - 通脹率) / (1 + 通脹率)

死亡需求 = PV(實際利率, 負擔年數, 年生活費) + IDE + 總債務（不含MRTA）
TPD需求 = PV(實際利率, 10年, 年生活費)
CI需求 = PV(實際利率, 3年, 年總支出) + RRF

IFS = 死亡保障 / 資金需求（含房貸+IDE）
DTF = 死亡保障可支撐家庭的月數（清所有貸款後）
```

---

## 📋 完整開發 & 修復紀錄

### v4.0 — 初始部署 (03/2026)
**Commit:** `a36e7d6`  
- FAR Financial Analysis Report v4 首次部署
- 基礎計算框架：死亡/TPD/CI 需求分析
- 5個 KPI 卡片（財務摘要）
- 基礎列印功能

---

### v4.1 — 初始功能迭代 (03-04/2026)
**Commits:** `08259cf` → `0b13ee9` → `ebf148d` → `da80340` → `babe7ba` → `307f088`  
- 多輪迭代修復（詳細改動不明，為早期快速開發階段）

---

### v4.2 — 三語言 + 動態保單行 (04/2026)
**Commit:** `9589cd2`  
**功能新增：**
- 完整三語言支援（中文 / English / Bahasa Malaysia）
- I18N 系統：`I18N` 物件 + `L(key)` + `setLang()` 函數
- 動態保單行：最多10份人壽保單 + 5份醫療卡（可新增/刪除行）
- `buildPolicyRows()` 動態生成帶選擇器的表格行
- FAB 選單 z-index 修復

---

### v4.3 — 醫療分析升級 (04/2026)
**Commits:** `2e52b8b`, `6247ec8`, `778f1af`, `b5fcf35`  

**功能新增：**
- 醫療卡 KPI 卡片（每日病房費/終身限額/MHI覆蓋率）
- 醫療保障建議自動生成
- 醫療表格合計行（最高值/合計值）

**修復：**
- 保險公司下拉清單完整（BNM 所有持牌保險公司，A-Z排序）
- 翻譯 placeholder 文字

---

### v4.4 — UI 優化 (04/2026)
**Commits:** `f74f254`, `9391fa7`, `8664718`, `45dd49d`

**功能新增：**
- Profile Setting 側邊抽屜（顧問資訊可保存到 localStorage）
- 等寬 5 欄 KPI 格狀排列

**修復：**
- KPI 卡片字體大小提升（value 13→16px）
- 防止 KPI 數字換行
- Gap cards 等寬顯示

---

### v4.5 — IC 自動計算年齡 (04/2026)
**Commit:** `163fbd3`

**功能新增：**
- 輸入馬來西亞 IC 號碼自動計算「下一個生日年齡」
- 計算方式：`calcNextBirthdayAge(ic)` — YYMMDD + 跨世紀處理
- 顯示「AUTO」標籤，提示年齡為自動填入

---

### v4.6 — 聯絡資料欄位 (04/2026)
**Commit:** `f0cd08a`

**功能新增：**
- 個人資料新增：聯絡電話 1、聯絡電話 2（如有）、電郵地址
- `BASE_IDS` 加入新欄位（確保儲存/載入）

---

### v4.7 — UI 修復 (04/2026)
**Commits:** `b55fde8`, `44ae697`

**修復：**
- 計算假設格狀佈局改為 2 欄（更整齊）
- placeholder 顏色改為淺灰（`#C4C9D4`，避免看起來像有值）
- 儲存按鈕改為置中緊湊樣式（非全寬）

---

### v4.8 — 風險比率表優化 (04/2026)
**Commits:** `382dd2d`, `4ec03fb`

**修復：**
- 風險比率表欄寬平衡（指標20%/值13%/標準18%/狀態14%/說明35%）
- 說明欄防止文字換行（`white-space:nowrap` → 改為 `word-wrap:break-word`）
- 保障缺口對比表：欄寬固定、數字右對齊、進度條變細

---

### v4.9 — I18N 全面修復 (04/2026)
**Commit:** `e2e9733`

**修復：**
- 有子元素的 label（`<span>` 包裹圖示）不更新問題
- TH 子文字（副文字如「(RM)」）切換語言後消失問題
- JavaScript 硬編碼中文字串（KPI labels、計算文字等）全部移入 I18N

---

### v4.10 — 響應式修復 (04/2026)
**Commits:** `9adbe23`, `a087842`

**修復：**
- 新增 Tablet 斷點（769px–1024px）：3欄 KPI → 3欄、grid4 → 2欄
- 保障缺口卡片在平板/手機上換行顯示
- 手機版風險比率表允許橫向滾動（移除 `overflow-x:hidden` 阻擋）

---

### v4.11 — 頁眉重設計 (04/2026)
**Commit:** `cd0f889`

**修復/改動：**
- 頁眉加高（56px → 68px）
- 標題字體加大（15px → 17px）
- 工具名稱改為「Financial Health Analysis」（更專業）
- 公司名稱「TEN Consultancy」放在 h1 前面（品牌優先）

---

### v4.12 — Bug 修復（02/05/2026）
**Commit:** `2df404e`

**修復：**

#### Bug 1：死亡需求缺少債務 ⚠️ 計算錯誤
- **問題：** `deathNeed` 計算只含「生活費 + IDE」，但工具說明寫「生活費 + 債務 + IDE」
- **修復：** `deathNeed = PV(realRate, yearsResp, -annExpDeath) + IDE + totalDebts`
- **影響：** 死亡保障缺口計算現在更準確（包含所有未由MRTA覆蓋的貸款餘額）

#### Bug 2：顧問備注重複顯示 🖥️ UI 問題
- **問題：** 顧問備注輸入後，printNote div 在螢幕上也顯示（重複文字）
- **修復：** printNote div 加上 `class="print-only"`，recalc 不再手動切換 display
- **影響：** 備注只在列印時顯示，螢幕正常

#### Bug 3：簽名欄文字切換語言無效 🌐 I18N 問題
- **問題：** `sigNote` 元素有子元素（`<strong>`），`setLang()` 跳過有子元素的非 TH/TD 元素
- **修復：** 翻譯字串加入 HTML 標記；`setLang()` 新增步驟 10 用 `innerHTML` 更新 `sigNote`
- **影響：** 切換至 EN/BM 後，簽名說明文字正確更新

#### Bug 4：示範資料缺少醫療保險公司 📋 資料問題
- **問題：** `loadDemo()` 設定人壽保單保險公司（p1co = AmMetLife）但未設定醫療卡保險公司（pm1co）
- **修復：** 新增 `document.getElementById('pm1co').value = 'AmMetLife'`
- **影響：** 示範資料載入後，醫療卡表格第1行正確顯示保險公司

---

### v4.13 — 車貸餘額顯示修復（02/05/2026）
**Commit:** `pending`

**修復：**

#### Bug：車貸餘額未顯示在債務明細表 🖥️ UI 問題
- **問題：** 財務摘要的「債務明細」表格只列出：自住房貸/投資房產貸款/信用卡+私人貸款，但 `totalDebts` 計算早已包含 `carLoanBal`，造成表格與實際合計不一致
- **修復：** 在三語 i18n（zh/en/bm）新增 `fsCarBal` key；在債務明細表格插入車貸餘額行（位於投資房產後、信用卡前）
- **影響：** 債務明細表格現完整顯示 4 項：自住房貸 / 投資房產 / **車貸餘額** / 信用卡+私人貸款，與合計金額完全吻合

---

## 🔧 已知待辦 / 未來改善方向

| 項目 | 說明 | 優先級 |
|------|------|--------|
| 投資房產 ip3/ip4 | 工具說「最多4個」但只有 ip1/ip2 | P3 |
| CI 建議金額本地化 | 目前固定建議 RM1M 醫療終身限額 | P3 |
| 保費合理性警告 | 保費超過月收入 10-15% 時給出警告 | P3 |
| 報告 PDF 直接下載 | 目前只能靠瀏覽器列印 | P3 |
| 客戶記錄雲端備份 | 目前只存 localStorage，換電腦會遺失 | P2 |

---

## 📁 檔案結構

```
/Users/ten/ten-far/
├── index.html              ← GitHub Pages 服務檔（從 FAR-v4.html 同步）
└── FAR_工作紀錄.md          ← 本紀錄檔（每次更新後覆蓋）

/Users/ten/Desktop/TEN Consultancy AI Management/
└── 📤 Serena 輸出/03 簡報/
    └── FAR-v4.html         ← 主源文件（編輯這裡，然後 cp + git push）
```

## 🚀 更新工作流程

```bash
# 1. 編輯主源文件
nano "📤 Serena 輸出/03 簡報/FAR-v4.html"

# 2. 同步到 GitHub repo
cp "📤 Serena 輸出/03 簡報/FAR-v4.html" /Users/ten/ten-far/index.html

# 3. 同步本工作紀錄
cp "📤 Serena 輸出/03 簡報/FAR_工作紀錄.md" /Users/ten/ten-far/FAR_工作紀錄.md

# 4. 推送到 GitHub（自動部署到 GitHub Pages）
cd /Users/ten/ten-far && git add . && git commit -m "描述" && git push
```

---

*此紀錄由 Serena 維護。每次修復/升級後更新，覆蓋舊版。*  
*最後更新：02/05/2026*
