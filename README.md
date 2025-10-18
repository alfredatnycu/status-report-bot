# LINE Bot 學員狀態回報系統

## 功能特色

### 1. 彈性時段設定
- 使用 `/settime` 指令自訂回報時段
- 範例：`/settime 09:00 16:00 21:00`
- 可設定任意數量的時段

### 2. 系統開關控制
- `/start` - 啟動系統，開始接受回報
- `/end` - 關閉系統，停止接受回報
- `/status` - 查看系統狀態

### 3. 學員管理
- 預設學員編號：33069-33085（共17位）
- 自動驗證學員編號
- `/roster` 查看完整名冊

## 指令列表

### 系統控制
- `/start` - 啟動系統
- `/end` - 關閉系統
- `/status` - 系統狀態
- `/settime HH:MM HH:MM ...` - 設定時段

### 查詢指令
- `/report` - 當前時段統計
- `/missing` - 未回報名單
- `/roster` - 學員名冊
- `/help` - 顯示說明

### 回報格式
```
學員編號 狀態
```
範例：
```
33069 在家
33070 外出
33071 請假
```

## Zeabur 部署步驟

### 1. 準備 LINE Bot
1. 到 [LINE Developers Console](https://developers.line.biz/) 建立 Messaging API Channel
2. 取得 `Channel Access Token`

### 2. 部署到 Zeabur
1. 前往 [Zeabur](https://zeabur.com/)
2. 建立新專案
3. 選擇 GitHub 連結或直接上傳程式碼
4. 設定環境變數：
   - `LINE_ACCESS_TOKEN` = 你的 Channel Access Token
   - `PORT` = 3000（Zeabur 會自動設定）

### 3. 設定 Webhook
1. 部署完成後，複製 Zeabur 給的網址
2. 回到 LINE Developers Console
3. 設定 Webhook URL：`https://your-domain.zeabur.app/webhook`
4. 啟用 Webhook

## 檔案結構
```
status_report_bot/
├── index.js              # 主程式
├── package.json          # 套件設定
└── data/                 # 資料目錄（自動產生）
    ├── records.json      # 回報記錄
    ├── roster.json       # 學員名冊
    └── config.json       # 系統設定
```

## 測試方式

### 本地測試
```bash
npm install
export LINE_ACCESS_TOKEN="your_token_here"
npm start
```

### 使用 ngrok 測試 Webhook
```bash
ngrok http 3000
```
將 ngrok 提供的 URL 設定到 LINE Webhook

## API 端點

- `GET /` - 健康檢查
- `POST /webhook` - LINE Webhook
- `GET /api/records` - 查詢所有記錄
- `GET /api/roster` - 查詢學員名冊
- `GET /api/config` - 查詢系統設定
- `GET /api/report/today` - 今日報表

## 注意事項

1. **系統預設啟動**：首次執行時系統為啟動狀態
2. **時段判斷**：自動根據台北時區（UTC+8）判斷當前時段
3. **重複回報**：同一學員在同一時段重複回報會覆蓋舊記錄
4. **學員名稱**：請手動編輯 `data/roster.json` 更新學員真實姓名

## 學員名冊格式

編輯 `data/roster.json`：
```json
[
  { "id": "33069", "name": "張三", "note": "" },
  { "id": "33070", "name": "李四", "note": "" }
]
```
