// ============================================
// Zeabur Node.js 部署方案
// 檔案結構：
// /index.js (這個檔案)
// /package.json
// /data/records.json (自動產生)
// /data/roster.json (自動產生)
// /data/config.json (自動產生)
// ============================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// 從環境變數讀取設定
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

// 資料檔案路徑
const DATA_DIR = path.join(__dirname, 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');
const ROSTER_FILE = path.join(DATA_DIR, 'roster.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// 確保資料目錄存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化資料檔案
if (!fs.existsSync(RECORDS_FILE)) {
  fs.writeFileSync(RECORDS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(ROSTER_FILE)) {
  // 學員名冊 33069-33085 共17位
  const defaultRoster = [];
  for (let i = 33069; i <= 33085; i++) {
    defaultRoster.push({
      id: String(i),
      name: `學員${i}`,
      note: ""
    });
  }
  fs.writeFileSync(ROSTER_FILE, JSON.stringify(defaultRoster, null, 2));
}

if (!fs.existsSync(CONFIG_FILE)) {
  // 預設配置：系統啟動、預設三個時段
  const defaultConfig = {
    systemEnabled: true,
    groupId: null,
    timeSlots: ["09:00", "16:00", "21:00"]
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
}

// ============================================
// LINE Webhook 入口
// ============================================
// Webhook 驗證端點（LINE 會先發送 GET 請求驗證）
app.get('/webhook', (req, res) => {
  res.status(200).send('Webhook endpoint is ready');
});

app.post('/webhook', async (req, res) => {
  try {
    // 立即回傳 200
    res.status(200).send('ok');

    const { events } = req.body;
    if (!events || events.length === 0) return;

    const event = events[0];

    // 記錄群組 ID（用於自動發送報表）
    if (event.source && event.source.type === 'group') {
      saveGroupId(event.source.groupId);
    }

    if (event.type !== 'message' || event.message.type !== 'text') return;

    const userMsg = event.message.text.trim();
    const replyToken = event.replyToken;

    // 處理指令
    if (userMsg.startsWith('/')) {
      await handleCommand(userMsg, replyToken);
      return;
    }

    // 檢查系統是否啟動
    const config = readConfig();
    if (!config.systemEnabled) {
      // 系統關閉時，靜默忽略回報訊息
      return;
    }

    // 處理回報：學員編號 狀態
    const match = userMsg.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      // 不符合格式，靜默忽略（不回應一般聊天訊息）
      return;
    }

    const studentId = match[1];
    const status = match[2];

    // 驗證學員編號
    if (!isValidStudent(studentId)) {
      // 不是有效學員編號，靜默忽略
      return;
    }

    // 儲存記錄（使用正確的日期和時段）
    const { timeSlot, date } = determineTimeSlotAndDate(new Date());
    saveRecord(studentId, status, timeSlot, date);

    const studentName = getStudentName(studentId);
    await replyLine(replyToken, `✅ ${studentName}(${studentId}) ${status}\n已登記 ${date} ${timeSlot} 時段`);

  } catch (error) {
    console.error('Webhook error:', error);
  }
});

// ============================================
// 配置管理
// ============================================
function readConfig() {
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { systemEnabled: true, groupId: null, timeSlots: ["09:00", "16:00", "21:00"] };
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function saveGroupId(groupId) {
  const config = readConfig();
  config.groupId = groupId;
  writeConfig(config);
}

function getGroupId() {
  const config = readConfig();
  return config.groupId;
}

// ============================================
// 儲存記錄
// ============================================
function saveRecord(studentId, status, timeSlot, date) {
  const records = readRecords();

  // 移除同日同時段同學員的舊記錄
  const filteredRecords = records.filter(r =>
    !(r.date === date && r.timeSlot === timeSlot && r.studentId === studentId)
  );

  const newRecord = {
    date,
    timeSlot,
    studentId,
    status,
    timestamp: new Date().toISOString()
  };

  filteredRecords.push(newRecord);
  fs.writeFileSync(RECORDS_FILE, JSON.stringify(filteredRecords, null, 2));

  console.log('Record saved:', newRecord);
}

function readRecords() {
  try {
    const data = fs.readFileSync(RECORDS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// ============================================
// 學員名冊管理
// ============================================
function readRoster() {
  try {
    const data = fs.readFileSync(ROSTER_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function isValidStudent(studentId) {
  const roster = readRoster();
  return roster.some(s => s.id === studentId);
}

function getStudentName(studentId) {
  const roster = readRoster();
  const student = roster.find(s => s.id === studentId);
  return student ? student.name : '未知';
}

// ============================================
// 時段判斷（使用配置檔的時段設定）
// ============================================
function determineTimeSlotAndDate(now) {
  const config = readConfig();
  const timeSlots = config.timeSlots || ["09:00", "16:00", "21:00"];

  // 台北時區 (UTC+8)
  const taipeiTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const currentMinutes = taipeiTime.getHours() * 60 + taipeiTime.getMinutes();
  let targetDate = new Date(taipeiTime);

  // 轉換時段為分鐘數並排序
  const slotsInMinutes = timeSlots.map(slot => {
    const [h, m] = slot.split(':').map(Number);
    return { slot, minutes: h * 60 + m };
  }).sort((a, b) => a.minutes - b.minutes);

  // 預報制：找到下一個時段
  for (let i = 0; i < slotsInMinutes.length; i++) {
    if (currentMinutes < slotsInMinutes[i].minutes) {
      // 找到下一個時段
      return {
        timeSlot: slotsInMinutes[i].slot,
        date: targetDate.toISOString().split('T')[0]
      };
    }
  }

  // 如果已過所有時段，回傳隔天的第一個時段
  targetDate.setDate(targetDate.getDate() + 1);
  return {
    timeSlot: slotsInMinutes[0].slot,
    date: targetDate.toISOString().split('T')[0]
  };
}

// 向後相容：只回傳時段
function determineTimeSlot(now) {
  return determineTimeSlotAndDate(now).timeSlot;
}

// ============================================
// LINE 指令處理
// ============================================
async function handleCommand(command, replyToken) {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch(cmd) {
    case '/start':
      const config = readConfig();
      config.systemEnabled = true;
      writeConfig(config);
      await replyLine(replyToken, '✅ 系統已啟動\n可以開始回報狀態');
      break;

    case '/end':
      const cfg = readConfig();
      cfg.systemEnabled = false;
      writeConfig(cfg);

      // 清空所有回報記錄
      fs.writeFileSync(RECORDS_FILE, JSON.stringify([], null, 2));

      await replyLine(replyToken, '⏸️ 系統已關閉\n已停止接受回報\n✅ 所有記錄已清空');
      break;

    case '/status':
      const statusCfg = readConfig();
      const statusMsg =
        `📊 系統狀態\n\n` +
        `運行狀態：${statusCfg.systemEnabled ? '✅ 啟動中' : '⏸️ 已關閉'}\n` +
        `當前時段：${determineTimeSlot(new Date())}\n` +
        `時段設定：${statusCfg.timeSlots.join(', ')}\n` +
        `學員總數：${readRoster().length} 人`;
      await replyLine(replyToken, statusMsg);
      break;

    case '/settime':
      // 格式：/settime 09:00 12:00 18:00
      if (parts.length < 2) {
        await replyLine(replyToken, '❌ 格式錯誤\n使用方式：/settime 09:00 16:00 21:00\n（可設定多個時段）');
        return;
      }

      const newSlots = parts.slice(1);
      // 驗證時間格式
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      const invalidSlots = newSlots.filter(slot => !timeRegex.test(slot));

      if (invalidSlots.length > 0) {
        await replyLine(replyToken, `❌ 時間格式錯誤：${invalidSlots.join(', ')}\n請使用 HH:MM 格式（例：09:00）`);
        return;
      }

      const timeCfg = readConfig();
      timeCfg.timeSlots = newSlots.sort();
      writeConfig(timeCfg);

      await replyLine(replyToken, `✅ 時段已更新\n新時段：${newSlots.join(', ')}`);
      break;

    case '/report':
      const report = generateReport();
      await replyLine(replyToken, report);
      break;

    case '/missing':
      const missing = getMissingStudents();
      await replyLine(replyToken, missing);
      break;

    case '/roster':
      const roster = readRoster();
      let rosterMsg = `📋 學員名冊（共${roster.length}人）\n\n`;
      roster.forEach(s => {
        rosterMsg += `${s.id} - ${s.name}\n`;
      });
      await replyLine(replyToken, rosterMsg);
      break;

    case '/help':
      const help =
        '📖 指令說明\n\n' +
        '【回報格式】\n' +
        '學員編號 狀態\n' +
        '例：33069 在家\n\n' +
        '【系統控制】\n' +
        '/start - 啟動系統\n' +
        '/end - 關閉系統\n' +
        '/status - 系統狀態\n' +
        '/settime HH:MM HH:MM - 設定時段\n\n' +
        '【查詢指令】\n' +
        '/report - 當前時段統計\n' +
        '/missing - 未回報名單\n' +
        '/roster - 學員名冊\n' +
        '/help - 顯示此說明';
      await replyLine(replyToken, help);
      break;

    default:
      await replyLine(replyToken, '❌ 未知指令，輸入 /help 查看說明');
  }
}

function generateReport() {
  const records = readRecords();
  const roster = readRoster();
  const { timeSlot, date } = determineTimeSlotAndDate(new Date());

  const todayRecords = records.filter(r => r.date === date && r.timeSlot === timeSlot);

  // 找到最後提交的記錄
  let lastSubmitter = null;
  if (todayRecords.length > 0) {
    const sortedRecords = todayRecords.sort((a, b) =>
      new Date(b.timestamp) - new Date(a.timestamp)
    );
    lastSubmitter = sortedRecords[0].studentId;
  }

  // 建立已回報學員 ID 的 Set
  const reportedIds = new Set(todayRecords.map(r => r.studentId));

  // 統計人數
  const reportedCount = todayRecords.length;
  const missingCount = roster.length - reportedCount;

  let msg = `📊 ${date} ${timeSlot} 時段\n已回報：${reportedCount} 人，未回報：${missingCount} 人\n\n`;

  // 按學號排序顯示所有學員
  roster.forEach(student => {
    if (reportedIds.has(student.id)) {
      // 找到該學員的回報記錄
      const record = todayRecords.find(r => r.studentId === student.id);
      const isLast = student.id === lastSubmitter ? ' 🏆最後提交' : '';
      msg += `${student.id} - ${record.status}${isLast}\n`;
    } else {
      // 未回報
      msg += `${student.id} - 未回報\n`;
    }
  });

  return msg;
}

function getMissingStudents() {
  const records = readRecords();
  const roster = readRoster();
  const { timeSlot, date } = determineTimeSlotAndDate(new Date());

  const reportedIds = new Set(
    records
      .filter(r => r.date === date && r.timeSlot === timeSlot)
      .map(r => r.studentId)
  );

  const missing = roster.filter(s => !reportedIds.has(s.id));

  if (missing.length === 0) {
    return '🎉 全員已回報！';
  }

  let msg = `⚠️ 未回報：${missing.length}人\n\n`;
  missing.forEach(s => {
    msg += `${s.id} ${s.name}\n`;
  });

  return msg;
}

// ============================================
// LINE API 回覆
// ============================================
async function replyLine(replyToken, text) {
  const url = 'https://api.line.me/v2/bot/message/reply';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text }]
      })
    });

    if (!response.ok) {
      console.error('Reply failed:', await response.text());
    }
  } catch (error) {
    console.error('Reply error:', error);
  }
}

// ============================================
// 推送訊息到群組（用於自動報表）
// ============================================
async function pushToGroup(groupId, text) {
  const url = 'https://api.line.me/v2/bot/message/push';

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: 'text', text }]
      })
    });
  } catch (error) {
    console.error('Push error:', error);
  }
}

// ============================================
// 查詢 API（網頁介面可用）
// ============================================
app.get('/', (req, res) => {
  res.send('LINE Bot Webhook is running!');
});

app.get('/api/records', (req, res) => {
  const records = readRecords();
  res.json(records);
});

app.get('/api/roster', (req, res) => {
  const roster = readRoster();
  res.json(roster);
});

app.get('/api/config', (req, res) => {
  const config = readConfig();
  res.json(config);
});

app.get('/api/report/today', (req, res) => {
  const records = readRecords();
  const today = new Date().toISOString().split('T')[0];
  const todayRecords = records.filter(r => r.date === today);

  res.json({
    date: today,
    records: todayRecords
  });
});

// ============================================
// 自動提醒功能
// ============================================
function setupAutoReminders() {
  const config = readConfig();
  const timeSlots = config.timeSlots || ["09:00", "16:00", "21:00"];

  timeSlots.forEach(slot => {
    const [hour, minute] = slot.split(':').map(Number);

    // 計算提醒時間（時段前5分鐘）
    let reminderMinute = minute - 5;
    let reminderHour = hour;

    if (reminderMinute < 0) {
      reminderMinute += 60;
      reminderHour -= 1;
      if (reminderHour < 0) reminderHour = 23;
    }

    // 設定 cron 任務（台北時區 UTC+8）
    const cronTime = `${reminderMinute} ${reminderHour} * * *`;

    cron.schedule(cronTime, async () => {
      console.log(`Auto reminder triggered for ${slot} time slot`);

      const groupId = getGroupId();
      if (!groupId) {
        console.log('No group ID found, skipping reminder');
        return;
      }

      const cfg = readConfig();
      if (!cfg.systemEnabled) {
        console.log('System disabled, skipping reminder');
        return;
      }

      // 發送報表
      const report = generateReport();
      await pushToGroup(groupId, `⏰ 提醒：${slot} 時段即將開始\n\n${report}`);

      // 發送未回報提醒
      const records = readRecords();
      const roster = readRoster();
      const { timeSlot, date } = determineTimeSlotAndDate(new Date());

      const reportedIds = new Set(
        records
          .filter(r => r.date === date && r.timeSlot === timeSlot)
          .map(r => r.studentId)
      );

      const missing = roster.filter(s => !reportedIds.has(s.id));

      if (missing.length > 0) {
        let reminderMsg = `⚠️ 尚未回報名單（${missing.length}人）\n請盡快回報狀態：\n\n`;
        missing.forEach(s => {
          reminderMsg += `${s.id}\n`;
        });
        await pushToGroup(groupId, reminderMsg);
      }
    }, {
      timezone: "Asia/Taipei"
    });

    console.log(`Scheduled reminder at ${reminderHour}:${reminderMinute.toString().padStart(2, '0')} for ${slot} time slot`);
  });
}

// ============================================
// 啟動伺服器
// ============================================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Webhook URL: /webhook');
  console.log('System status:', readConfig().systemEnabled ? 'Enabled' : 'Disabled');

  // 啟動自動提醒
  setupAutoReminders();
  console.log('Auto reminders activated');
});
