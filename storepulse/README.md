# StorePulse Pro（繁體中文）

商家營收 CSV 分析的 **純前端、免帳號、免 API** 示範作品。**並非正式財務或會計系統。**

## 如何啟動

解壓 ZIP 後在本資料夾啟動本機靜態伺服器：

```bash
python -m http.server 8000
```

開啟 `http://localhost:8000/`。或部署至 GitHub Pages 的 `/storepulse/` 目錄（需保留各檔案與資料夾的相對路徑）。由於 `fetch()` 會載入示範 CSV，不建議直接以 `file://` 打開首頁。

## CSV 欄位

必填：`date,order_id,product,quantity,unit_price,channel`

選填：`status,discount,shipping,cost`

- 日期：YYYY-MM-DD；金額使用新臺幣。
- 每個 CSV 資料列為**一筆商品明細**。`quantity × unit_price` 為商品總額。`discount`、`shipping` 是該明細列的總金額（不重複計算訂單層級金額）。`cost` 是**每件商品成本**。
- `status` 為 `paid`、`refunded`、`cancelled`，亦支援部份中文別名；缺省 `paid`。
- `refunded` 為單獨的退款商品明細列；系統不會主動將原始已付款商品行轉成退款行。取消訂單不計入營收。
- 已付款的訂單數是**按 order_id 去重**，不是商品明細行數；退款不增加訂單數。
- 淨營收 = 已付款商品總額 − 已付款折扣 − 退款淨額 + 已付款運費。
- 在完整成本資料存在時才顯示簡化毛利估計，不含稅、營運費用等。

## 設計限制

- 預設使用 `data/sample-orders.csv` 的虛構合成資料；不含任何真實客戶資料。
- CSV 僅在當前瀏覽器處理，不主動發送給後端；若網站託管由第三方提供，載入靜態頁本身仍依託管服務一般紀錄政策。
- 檔案上限 5MB，資料列上限 20,000；基本欄位檢核後會排除格式錯誤的資料列。
- 不提供跨平台帳務自動對帳、付款核實、稅額或匯率計算、完整財務報表、正式 POS 介接。
- CSV 中的可疑文字以 `textContent` 呈現，不插入 HTML；匯出使用公式注入防護。

## 自動化測試

```bash
node --test tests/*.test.mjs
node --check assets/app.mjs
node --check assets/core.mjs
```

## 給 Codex 的整合說明

請將 ZIP 內所有內容放入 `gogoray03/gogoray03.github.io` 儲存庫的 `storepulse/` 目錄，並在首頁作品卡加入 `href="/storepulse/"` 的「線上試用」連結。先在新分支測試，建立 PR；未經使用者確認勿直接合併至 main。**注意**，本專案是基於原先 StorePulse 的功能規格重新建構的 Pro 展示版本，並非宣稱已復原當年全部原始碼。
