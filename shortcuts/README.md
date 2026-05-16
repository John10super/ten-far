# 早安田總 Morning Briefing — iPhone 捷徑（iOS 26.5）

執行時會：

1. 用中文問候「早安田總」
2. 唸出目前位置的天氣（今天 {城市} 的天氣是 {天氣}，溫度 {度數}）
3. 唸出**今日到期的提醒事項**（Apple Reminders）
4. 唸出**所有未完成 / 過期的提醒**
5. 唸出**今日行事曆**
6. 唸出**未來 24 小時行事曆**
7. 唸出**Google Tasks 待辦事項**（透過 REST API）
8. 收尾祝福

語音輸出有兩個版本，請二選一：

| 版本 | 聲音 | 需要 API key | 延遲 | 備註 |
| --- | --- | --- | --- | --- |
| `morning-briefing.shortcut` | iOS 內建 Siri（zh-TW） | ❌ | 即時 | 開箱即用，最穩 |
| `morning-briefing-gemini.shortcut` | **Gemini 2.5 Flash TTS — Zephyr** | ✅ | 每段 1–2 秒 | 需先匯入 `gemini-speak.shortcut` 並貼上 API key |

---

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `morning-briefing.shortcut`        | Siri 版主捷徑 |
| `morning-briefing-gemini.shortcut` | Gemini 版主捷徑（透過 Run Shortcut 呼叫下方子捷徑） |
| `gemini-speak.shortcut`            | 子捷徑：把輸入文字交給 Gemini TTS 播放 |
| `*.plist`                          | 上述三個檔案的 XML 版本，方便檢視 |
| `build_shortcut.py`                | 產生主捷徑（Siri + Gemini） |
| `build_gemini_speak.py`            | 產生 Gemini Speak 子捷徑 |

重新產生：

```bash
cd shortcuts
python3 build_gemini_speak.py
python3 build_shortcut.py
```

---

## iOS 26.5 安裝步驟

### 1. 開啟「允許不受信任的捷徑」（只需做一次）

iOS 26 把這個選項移到：

> **設定 → App → 捷徑 → 進階 → 允許不受信任的捷徑**
> (Settings → Apps → Shortcuts → Advanced → Allow Untrusted Shortcuts)

如果選項是灰的：先打開「捷徑」App 隨便執行一個捷徑，再回來開。

### 2. 把 `.shortcut` 檔送到 iPhone

- AirDrop（最快）
- iCloud Drive → iPhone「檔案」App 點開
- Email 附件

點開後選「**加入不受信任的捷徑**」。

### 3. 匯入順序

**若選 Gemini 版**，順序很重要：

1. 先匯入 `gemini-speak.shortcut`
2. 在「捷徑」App 編輯它，第二個 Text 動作裡把 `PASTE_YOUR_GEMINI_API_KEY_HERE` 換成你的 API key（取得方式見下）
3. 再匯入 `morning-briefing-gemini.shortcut`
4. 第一次執行主捷徑會自動授權「執行其他捷徑」、位置、提醒、行事曆、網路

**若選 Siri 版**：直接匯入 `morning-briefing.shortcut` 就好。

---

## Gemini TTS 設定

### 1. 取得 API key

1. 打開 <https://aistudio.google.com/apikey>（用 Google 帳號登入）
2. 按「**Create API key**」→ 選一個 Google Cloud 專案（或讓它幫你建一個）
3. 複製出來的 key（格式 `AIza...`）

> Gemini API 在 AI Studio 免費額度內可用，TTS preview 模型在台灣 / 美國等地區皆可用。

### 2. 貼進子捷徑

捷徑 App → 點 **Gemini Speak (Zephyr)** → 右上 ⋯ 編輯 →
找到第二個 **Text** 動作（內容是 `PASTE_YOUR_GEMINI_API_KEY_HERE`）→
整段換成你的 key → 完成。

### 3. 想換聲音？

把 `build_gemini_speak.py` 第 22 行的 `VOICE_NAME = "Zephyr"` 改成下表任一，重跑腳本：

| Voice    | 風格 |
| -------- | --- |
| Zephyr   | 女聲，明亮活潑 |
| Kore     | 女聲，沉穩清晰 |
| Puck     | 男聲，年輕上揚 |
| Charon   | 男聲，溫暖成熟 |
| Aoede    | 女聲，柔和 |
| Fenrir   | 男聲，渾厚 |

或直接編輯子捷徑裡建構 JSON 的那個 Text 動作，把 `Zephyr` 改掉。

### 4. 已知限制

- **延遲**：每段話約 1–2 秒網路延遲。整個 briefing 約多花 20–30 秒。
- **配額用盡 / 網路失敗**：那一段會沒聲音、但捷徑會繼續。可在 `gemini-speak.shortcut` 加 If 動作做 fallback 到 Speak Text。
- **Play Sound**：iOS 26 的 Play Sound 接受任意音訊檔。若沒聲音，把最後一個動作換成 **Quick Look**（`is.workflow.actions.previewdocument`）並重試。
- **WAV header trick**：子捷徑會在 base64 audio 前面塞一段固定的 54-byte WAV header（RIFF/data size 都填 0xFFFFFFFF）。Gemini 回傳的是 24 kHz mono 16-bit raw PCM；header 對齊 3-byte 邊界讓 base64 串接安全。

---

## Google Tasks 設定（一次性）

Google Tasks 沒有原生 Shortcuts 動作，所以這裡直接呼叫 REST API。需要 OAuth Bearer Token。

最快用 OAuth 2.0 Playground：

1. 打開 <https://developers.google.com/oauthplayground>
2. 左邊找 **Tasks API v1** → 勾 `https://www.googleapis.com/auth/tasks.readonly`
3. 按「Authorize APIs」→ 授權
4. Step 2 按「Exchange authorization code for tokens」
5. 複製產生的 **Access token**（`ya29.a0...`）

到主捷徑裡找 `PASTE_YOUR_GOOGLE_OAUTH_BEARER_TOKEN_HERE` 那個 Text 動作，整段換掉。

⚠️ access token 1 小時就過期。長期方案：

| 做法 | 難度 | 說明 |
| --- | --- | --- |
| Refresh token 換 access token | 中 | 子捷徑裡先 POST `https://oauth2.googleapis.com/token` 取新 token |
| 同步到 Apple Reminders | 低 | 第三方 App（如 Tasks for Google Tasks）幫你雙向同步 |
| **改用 Google Calendar** | 低 | iPhone 設定 → 行事曆 → 加入 Google 帳號。Google Tasks 會以行事曆事件出現，今日 / 24 小時段落會自動讀到。可把 Google Tasks 段落整段刪掉 |

最省事的是第三個。

---

## 觸發方式

- **嘿 Siri，早安田總** ← 捷徑名稱就是 Siri 觸發語
- 主畫面長按 → 加「捷徑」widget
- **每天早上 9 點自動播放**（見下方設定）

### 設定每日早上 9:00 自動執行（iOS 26.5）

> ⚠️ 自動化不能用 `.shortcut` 檔匯入，必須在 iPhone 上手動建一次。約 1 分鐘。

1. 打開「**捷徑**」App → 底部 Tab 切到「**自動化**」
2. 右上角 **＋** → 「**建立個人自動化**」
3. 選「**特定時間**」(Time of Day)
4. 把時間設為 **上午 9:00**，重複選 **「每天」**
5. 下一步 → 「**新增動作**」
6. 搜尋並選「**執行捷徑**」(Run Shortcut)
7. 點欄位裡的「捷徑」→ 選：
   - 用 Siri 版：**早安田總 Morning Briefing**
   - 用 Gemini 版：**早安田總 Morning Briefing (Gemini)**
8. 下一步 → 把「**執行前詢問**」(Ask Before Running) **關掉**
   - 系統會跳出確認「不要詢問」，按確認
9. 把「**執行時通知**」(Notify When Run) 也可以關掉（看你要不要看到通知）
10. 完成

每天早上 9:00 iPhone 會自動執行（裝置需解鎖一次後，背景就會跑；某些音訊播放需要解鎖狀態才能出聲，建議放在床邊鬧鐘之後）。

> 💡 想要鬧鐘響完接著播？把自動化觸發改成「**鬧鐘停止時**」(When Alarm is Stopped) 並指定你的早晨鬧鐘。

---

## 如果匯入失敗 — 手動建立

iOS 偶爾會在新版改 action identifier；若你看到「未知動作」，直接在捷徑 App 裡照下面手動建：

```
1. Comment: === 早安問候 ===
2. Speak Text: "早安田總"  (Language: 中文（台灣）)   ← Gemini 版改用 Run Shortcut "Gemini Speak (Zephyr)" with input "早安田總"

3. Comment: === 天氣 ===
4. Get Current Weather at Current Location
5. Get Details of Weather Conditions: City              → 變數 city
6. Get Details of Weather Conditions: Conditions        → 變數 condition
7. Get Details of Weather Conditions: Temperature       → 變數 temp
8. Speak / Run Shortcut: "今天 [city] 的天氣是 [condition]，溫度 [temp]"

9. Comment: === 今日提醒 ===
10. Speak / Run Shortcut: "今天的提醒事項："
11. Find Reminders where (Is Completed is false) AND (Due Date is today)
12. Repeat with Each:
      Get Name of Reminder
      Speak / Run Shortcut: [Name]

13. Comment: === 未完成提醒 ===
14. Speak / Run Shortcut: "以下是所有未完成的提醒："
15. Find Reminders where (Is Completed is false)
16. Repeat with Each:
      Get Name of Reminder
      Speak / Run Shortcut: [Name]

17. Comment: === 今日行事曆 ===
18. Speak / Run Shortcut: "今天的行程："
19. Find Calendar Events where (Start Date is today)
20. Repeat with Each:
      Get Title of Calendar Event
      Speak / Run Shortcut: [Title]

21. Comment: === 未來 24 小時 ===
22. Speak / Run Shortcut: "接下來 24 小時的行程："
23. Find Calendar Events where (Start Date is between Now and Tomorrow)
24. Repeat with Each:
      Get Title of Calendar Event
      Speak / Run Shortcut: [Title]

25. Comment: === Google Tasks ===
26. Text: <Bearer token>                           → 變數 token
27. Get Contents of URL:
      URL:     https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false
      Method:  GET
      Headers: Authorization = "Bearer [token]"
               Accept        = "application/json"
28. Get Dictionary Value: items   (from Contents of URL)
29. Speak / Run Shortcut: "以下是 Google Tasks 待辦事項："
30. Repeat with Each (Dictionary items):
      Get Dictionary Value: title (from Repeat Item)
      Speak / Run Shortcut: [title]

31. Speak / Run Shortcut: "以上是今日簡報，祝您有美好的一天。"
```

Siri 版每個 Speak Text 記得語言設「中文（台灣）」並勾「Wait Until Finished」。
