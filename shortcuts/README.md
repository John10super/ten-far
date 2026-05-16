# 早安田總 Morning Briefing — iPhone 捷徑

一個 iOS Shortcut，會在執行時：

1. 用中文問候「早安田總」
2. 取得目前位置的天氣，以**國語**唸出（今天 {城市} 的天氣是 {天氣}，溫度 {度數}）
3. 唸出**今日到期的提醒事項**（Apple Reminders）
4. 唸出**所有未完成的提醒**（含過期）
5. 唸出**今日行事曆**
6. 唸出**未來 24 小時的行事曆**
7. 唸出**Google Tasks 待辦事項**

所有語音輸出皆為 `zh-TW` 中文（國語）。

---

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `morning-briefing.shortcut` | 二進位 plist，可直接匯入 iPhone |
| `morning-briefing.plist`    | XML 版本，方便檢視 / 編輯 |
| `build_shortcut.py`         | 產生上面兩個檔案的 Python 腳本 |

要重新產生：

```bash
cd shortcuts
python3 build_shortcut.py
```

---

## 安裝步驟

### 1. 開啟「允許不受信任的捷徑」

因為這個 `.shortcut` 檔案沒有 Apple 的 iCloud 簽章，iPhone 預設不會匯入。**只需做一次**：

1. iPhone → 設定 → 捷徑
2. 開啟「**允許不受信任的捷徑**」（Allow Untrusted Shortcuts）
   - 若選項是灰的：先打開「捷徑」App，隨便執行一個捷徑，這個選項就會解鎖。

### 2. 把 `.shortcut` 檔送到 iPhone

任選一種：

- **AirDrop**：在 Mac 上對 `morning-briefing.shortcut` 按右鍵 → 分享 → AirDrop 到 iPhone
- **iCloud Drive**：把檔案丟進 iCloud Drive，在 iPhone「檔案」App 點開
- **Email**：把檔案寄給自己，在 iPhone 點開附件

點開後 iPhone 會問你要不要加入「捷徑」App，按「**加入不受信任的捷徑**」。

### 3. 給予權限

第一次執行時 iOS 會請你授權：

- 位置（天氣用）
- 提醒事項
- 行事曆
- 網路（Google Tasks 用）

每一項都要允許。

---

## Google Tasks 設定（一次性，需要 5 分鐘）

Google Tasks 沒有原生的 Shortcuts 動作，所以這個捷徑直接呼叫 Google 的 REST API。你需要一個 **OAuth Bearer Token**。

最快的方式是用 Google 自家的 **OAuth 2.0 Playground**：

1. 打開 <https://developers.google.com/oauthplayground>
2. 在左邊找到 **Tasks API v1** → 勾選 `https://www.googleapis.com/auth/tasks.readonly`
3. 按「Authorize APIs」→ 用你的 Google 帳號登入授權
4. 在 Step 2 按「Exchange authorization code for tokens」
5. 複製產生的 **Access token**（看起來像 `ya29.a0AfH6...`）

> ⚠️ Access token 只能用 **1 小時**就會過期。
> 想要長期自動運作，請按下面的「長期方案」。

把 token 貼進捷徑：

1. 開啟「捷徑」App → 找到「早安田總 Morning Briefing」→ 點右上「⋯」編輯
2. 找到中間有一個 **Text** 動作，內容是 `PASTE_YOUR_GOOGLE_OAUTH_BEARER_TOKEN_HERE`
3. 把那段字整個替換成你剛剛複製的 token
4. 按完成

執行捷徑試看看，若聽到 Google Tasks 的內容就成功了。

### 長期方案（避免每小時換 token）

如果你想讓這個捷徑可以自動排程、不用每小時手動換 token，有幾種做法：

| 做法 | 難度 | 說明 |
| --- | --- | --- |
| **用 Refresh Token 換 Access Token** | 中 | 在捷徑裡先 POST `https://oauth2.googleapis.com/token` 用 refresh token 換新的 access token，再呼叫 Tasks API |
| **同步到 Apple Reminders** | 低 | 用第三方服務（例：[Tasks for Google Tasks](https://apps.apple.com/app/tasks-google-tasks/id1531169858)）把 Google Tasks 變成 Apple 提醒事項，就不需要 OAuth |
| **改用 Google Calendar Tasks** | 低 | Google Tasks 也會出現在 Google Calendar 裡。把 Google 帳號加進 iPhone 設定 → 行事曆，捷徑的「今日行事曆」部分就會自動讀到 Tasks |

最省事是第三個：iPhone「設定 → 行事曆 → 帳號 → 加入帳號 → Google」，就會跟著進來。之後可以把捷徑裡 Google Tasks 那段刪掉。

---

## 如何觸發

匯入後可以這樣執行：

- **Hey Siri，早安田總** （捷徑名稱就是 Siri 觸發語）
- 主畫面長按 → 加入「捷徑」widget
- 設定 → 捷徑 → 自動化 → 個人自動化 → 每天 07:00 → 執行捷徑「早安田總 Morning Briefing」

---

## 如果匯入失敗 — 手動建立步驟

如果 iOS 拒絕匯入 `.shortcut` 檔（例如 iOS 版本不相容），可以在「捷徑」App 裡手動建立。下面是完整動作清單，照順序加：

```
1. Comment: === 早安問候 ===
2. Speak Text: "早安田總"  (Language: 中文（台灣）)

3. Comment: === 天氣 ===
4. Get Current Weather at Current Location
5. Get Details of Weather Conditions: City              → 變數 city
6. Get Details of Weather Conditions: Conditions        → 變數 condition
7. Get Details of Weather Conditions: Temperature       → 變數 temp
8. Speak Text: "今天 [city] 的天氣是 [condition]，溫度 [temp]"

9. Comment: === 今日提醒 ===
10. Speak Text: "今天的提醒事項："
11. Find Reminders where (Is Completed is false) AND (Due Date is today)
12. Repeat with Each:
      Get Name of Reminder
      Speak Text: [Name]

13. Comment: === 未完成提醒 ===
14. Speak Text: "以下是所有未完成的提醒："
15. Find Reminders where (Is Completed is false)
16. Repeat with Each:
      Get Name of Reminder
      Speak Text: [Name]

17. Comment: === 今日行事曆 ===
18. Speak Text: "今天的行程："
19. Find Calendar Events where (Start Date is today)
20. Repeat with Each:
      Get Title of Calendar Event
      Speak Text: [Title]

21. Comment: === 未來 24 小時 ===
22. Speak Text: "接下來 24 小時的行程："
23. Find Calendar Events where (Start Date is between Now and Tomorrow)
24. Repeat with Each:
      Get Title of Calendar Event
      Speak Text: [Title]

25. Comment: === Google Tasks ===
26. Text: <貼上 Bearer Token>                            → 變數 token
27. Get Contents of URL:
      URL:     https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false
      Method:  GET
      Headers: Authorization = "Bearer [token]"
               Accept        = "application/json"
28. Get Dictionary Value: items   (from Contents of URL)
29. Speak Text: "以下是 Google Tasks 待辦事項："
30. Repeat with Each (Dictionary items):
      Get Dictionary Value: title  (from Repeat Item)
      Speak Text: [title]

31. Speak Text: "以上是今日簡報，祝您有美好的一天。"
```

每個「Speak Text」記得把 Language 設成「中文（台灣）」，並開啟「Wait Until Finished」。

---

## 已知限制 / 注意

- **未簽章捷徑** — 必須開啟「允許不受信任的捷徑」。
- **Google Tasks token 過期** — Playground 的 access token 1 小時後失效；長期請參考上面的「長期方案」。
- **API 動作 ID** — Apple 偶爾會在新版 iOS 修改 action identifier。若匯入後某些動作顯示為「未知動作」，請用上面的手動步驟對照修補。
- **語音速度 / 音調** — 捷徑中設定為 rate=0.5、pitch=1.0，可在編輯畫面調整。
