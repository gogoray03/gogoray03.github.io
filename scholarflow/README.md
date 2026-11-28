# ScholarFlow AI V1.0
獨立課程工作區；無付費 API 的批次分析原型。未經學術品質或端到端驗證，不宣稱超越 Claude 或 NotebookLM。

## 使用
1. 在 GitHub Pages 的 /scholarflow/ 建立課程，填寫名稱、學校、教授、課程大綱與補充文字，按儲存。
2. 匯出 scholarflow-task.json。
3. 下載本目錄的 scholarflow.ipynb，前往 https://colab.research.google.com/ 上傳筆記本，選擇 GPU 執行階段（如有）。
4. 依順序執行儲存格，上傳任務 JSON 與合法取得的教材 PDF、PPTX、DOCX、TXT 或 MD。
5. 等待模型分析並下載 scholarflow-result.json。回網站原課程匯入即可查看分級筆記、選擇題、教學線索與錯題。
6. 可匯出 Markdown 或課程備份 JSON；備份 JSON 可透過同一匯入欄位還原為獨立課程。

## 架構
- 靜態 HTML/CSS/JavaScript；無金鑰、無網站後端、無 CDN 依賴。
- localStorage 個人課程與最近一次作答；儲存容量有限、無跨裝置自動同步。
- Colab Python：PDF/PPTX/DOCX 文字解析、分段生成、JSON 結構及短引文字串檢查。
- Qwen2.5-7B-Instruct 4-bit GPU；CPU 後備 Qwen2.5-1.5B-Instruct。免費 GPU 並非保證。
- 預設最多分析 20 個區段，超額警告。沒有 OCR、圖片、錄音、圖表辨識或外部資料查核。
- 教學特徵僅從教材明確提示提取，不預測未公開考題，不依教授姓名蒐集個資。
- 延伸知識、題目及答案可能錯誤；逐字引文存在並不能證明生成結論正確。請對照原教材。
- 教材留在瀏覽器或使用者主動上傳的 Colab 環境，不要上傳私人、敏感、未授權資料；不在 GitHub 存放教材或金鑰。
- 不提供長期在線 GPU 服務；Colab 運算需手動啟動。
- 後續：教材搜尋/RAG、跨段整合、來源語意驗證、自適應題庫、PPTX/PDF 匯出、知識地圖與互動家教。現版尚未提供這些功能。

## 測試
在本目錄執行 `node test.js`。
已於開發環境對 app.js 的資料驗證函式執行六項案例：接受有效空結果及考題；拒絕超界答案、重複 ID、危險 ID、錯誤警告欄位。這不等同於端到端測試。需另行在 Colab 實際載入模型、使用獲授權的教材並於手機/電腦測試匯入、備份、作答與匯出。
