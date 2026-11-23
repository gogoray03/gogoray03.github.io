# 自動化與資料分析工作室

繁體中文個人接案網站，使用原生 HTML、CSS、JavaScript，不需建置或第三方執行環境，可由 GitHub Pages 直接提供根目錄靜態檔案。

## 維護內容

- `index.html`：首頁、服務、作品、關於、流程、FAQ、聯絡區。
- `assets/style.css`：響應式版型與 reduced-motion 支援。
- `assets/main.js`：手機選單、聯絡入口、需求範本複製及失敗備援。
- `assets/config.js`：公開聯絡設定。
- `404.html`、`robots.txt`、`sitemap.xml`：錯誤頁與搜尋引擎設定。
- `tests/check.mjs`：零相依的結構、聯絡設定與剪貼簿備援檢查。

## 設定聯絡方式

在 `assets/config.js` 填入站長的公開 email、platformName 與 platformUrl。接案平台只接受 HTTPS 網址。留空時不建立假連結，顯示尚未開放洽詢。請勿放入任何金鑰或密碼；此檔公開可讀。電子郵件入口會開啟訪客的郵件軟體，不會由網站寄信。網站沒有表單後端，也不儲存洽詢資料。

## StorePulse

原始 Repository 僅有作品名稱與模擬資料聲明，沒有 StorePulse 原始碼。新版保留作品介紹並標示待驗證，不提供假的儀表板、數據或功能宣稱。收到原始碼後，應先確認安裝步驟、資料來源、授權、主要流程與測試，再決定是否能靜態部署於 GitHub Pages。需要 Python 伺服器的版本不能直接在 Pages 執行。

新增作品可在 `#work` 複製 `.project` 區塊，填入可查證的內容，清楚區分練習與客戶專案，僅連結已驗證的展示。

## 檢查與預覽

以 Node.js 執行 `node tests/check.mjs`、`node --check assets/main.js` 及 `node --check assets/config.js`。使用任意靜態 HTTP 伺服器於根目錄預覽。也可直接開啟 index.html；在剪貼簿 API 不可用時會顯示可手動複製的文字欄位。

## 分支與發布

本次修改分支：`redesign/freelance-portfolio`；基底：`8aa2d50c3502ca84a91ac1bbab0b652a87086e26`。

先推送分支並建立以 main 為目標的 PR。PR 不會自動產生 GitHub Pages 分支預覽，因此需使用本機預覽或經授權另設預覽部署。不要為了預覽更改正式 Pages 來源。

取得使用者確認後才合併。合併前確認 GitHub Settings → Pages 原有來源設定；若使用 branch 部署，應使用 main 的根目錄。此版本沒有變更 Pages 設定或自動部署工作流程。

原站備份另附 ZIP；Git 歷史保留原始提交。要復原已發布版本，使用審查過的 revert 提交，不強制覆寫歷史。

正式發布前須填入至少一個真實聯絡方式。搜尋排名、Core Web Vitals、真實裝置與螢幕閱讀器結果尚未驗證。
