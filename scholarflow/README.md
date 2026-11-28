# ScholarFlow AI V1.1

免費 Colab 批次分析，無付費 API、金鑰或網站後端。僅修改 scholarflow/，PR #6 保持 draft，不合併 main。

## 使用

- [一鍵 benchmark-v1.1.ipynb](https://colab.research.google.com/github/gogoray03/gogoray03.github.io/blob/feature/scholarflow-v1/scholarflow/benchmark-v1.1.ipynb)：全新 GPU 執行階段 → 全部執行。內建合成教材，預設 Qwen 7B，不需上傳資料。
- [教材分析 Notebook](https://colab.research.google.com/github/gogoray03/gogoray03.github.io/blob/feature/scholarflow-v1/scholarflow/scholarflow.ipynb)：上傳網站匯出的任務 JSON 與獲授權 PDF/PPTX/DOCX/TXT/MD，下載結果後匯入原課程。
- MODEL 下拉選單提供 Qwen2.5-7B/14B-Instruct、DeepSeek-R1-Distill-Qwen-7B/14B。先取得 Qwen 7B 有效筆記及考題並人工查核，再手動切換；不會自動載入所有模型。
- 舊 benchmark.ipynb 保留作 V1 歷史版本，請使用 benchmark-v1.1.ipynb。

## 引用與生成流程

教材切為最多 180 字的精確原文區段，編為 S0001 等 ID，保留來源標籤及字元起迄位置。模型只填 sourceIds，由程式填入原文；未知或重複 ID 拒絕。每組最多六段、預設最多 20 組，超額警告。**原文映射不保證選對來源，也不代表引用在語意上支持主張。**

每組依序：教材概念分析 → 深入教學 → 一道四選一題 → 獨立解題 → 品質評估。獨立解題不提供候選答案和解釋；答案不一致、非唯一正解或覆核失敗的題目會排除。同模型仍可能共同犯錯。

JSON 修復支援 Markdown 包裝、完整 reasoning 區塊分離、物件擷取、字串外尾逗號及安全 Python literal 轉換。不補寫截斷內容，不執行模型程式碼。每階段最多三次嘗試（首次 + 兩次帶錯誤提示的重新生成）；資源錯誤不當成 JSON 問題重試。

合成 benchmark ZIP 保存每次模型原始輸出、修復方式、詳細錯誤、階段、嘗試次數、來源、模型 revision、環境版本、計時與 allocated/reserved 峰值 VRAM。每次嘗試後立即保存 audit；模型載入失敗也輸出失敗報告。私人教材診斷只留在使用者 Colab，不自動上傳 GitHub。V1 原始輸出未保留，無法追溯 8 筆失敗的確切原因。

## 評估

| 指標 | 意義與限制 |
|---|---|
| structural_smoke_pass | 至少一份筆記和一題通過結構、來源映射及題目同模型覆核；不代表學術正確 |
| citation_mapping | 所選 ID 對應精確原文；不表示原文支持主張 |
| fixed_gold_correct / total | 三道人工編寫、固定答案的合成教材題答對數；不推論真實課程品質 |
| academic / citationSupport / teaching | 同模型以 0=錯誤或不足、1=部分、2=充分評估並保留理由；非獨立查核，失敗標 unavailable |
| human_review | 預設 pending；人工確認概念、引用關聯、唯一正解、選項及教學清晰度 |

自動管線永遠輸出 academic_quality_verified=false、semantic_support_verified=false。人工審查請填 ZIP 的獨立評估表，記錄審查者、0–2 分與修正內容；不將格式成功換算為學術分數。教材本身也可能有誤。

## GPU 與套件

採 4-bit NF4、double quantization、float16、單 GPU，不自動 CPU offload。載入前卸載舊模型、回收參照及 CUDA cache，檢查可用 VRAM。7B 門檻為 7–7.5 GiB，14B 為 12–12.5 GiB，均為估計，KV cache 或環境差異仍可能 OOM。無 GPU 明確停止；完成、載入失敗或 OOM 均卸載模型，外部仍持有的參照可能需要重啟執行階段。

requirements-colab.txt 固定模型工具版本，不覆寫預裝 torch/CUDA/numpy，不加入 Gradio。Notebook 在 import 前安裝，保存安裝前後 pip check 和版本；殘留衝突標 dependency_check_pass=false。**尚未在目前 Colab 映像完成套件相容性驗證**，固定版本不能保證所有未來映像可用。請使用全新執行階段，保留 pip/import 錯誤。

設定參考：[Hugging Face bitsandbytes 文件](https://huggingface.co/docs/transformers/quantization/bitsandbytes)、[DeepSeek 模型卡](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-14B)。DeepSeek 使用 user role 指令、temperature 0.6、3072 個輸出 token，可能截斷；Qwen greedy、1200 tokens；總上下文上限 8192 tokens。

## 測試結果（2026-11-28）

- 24 項 Python unittest 通過：引用、JSON、有限重試、錯誤保存、答案不一致拒絕、模型切換/卸載、VRAM 守門、benchmark 成功與失敗匯出。模型和 CUDA 都是 mock。
- 6 項既有 JavaScript schema 測試通過。
- 兩份新版 Notebook 通過 nbformat 4.5、全部 code cells Python 語法及嵌入模組一致性檢查。不是 GPU 執行測試。
- 使用者提供的 V1 實測：Tesla T4，14.56 GiB，Qwen2.5-7B-Instruct，峰值 allocated 5.66 GiB，載入 498.06 秒，分析 67.26 秒，0/8 筆通過。
- **V1.1 四個模型均尚未實際 GPU 推理，成功率與效能未知。** 本機無 Colab GPU，未宣稱 Qwen 7B 已實測成功。

重現：

```sh
cd scholarflow
python -m unittest discover -p 'test_*.py' -v
node test.js
python build_notebooks.py
python -m pip install nbformat
python check_notebooks.py
```

build_notebooks.py 將受測模組直接嵌入 Notebook，不在執行時下載可變分支程式碼。

## 限制

無 OCR、圖片、錄音或圖表辨識；固定字元分段可能切斷句子；每組一份筆記與一題，尚無跨組課程綜合。V1.1 不推測教授個人特徵，professorEvidence 為空。延伸內容待核實；同模型評分有偏誤；人工審查表不自動寫回網站。未完成真實 Colab GPU、套件相容性及瀏覽器端到端驗收。localStorage 無跨裝置同步，免費 GPU 配額不保證可用。本次僅更新 feature 分支，正式 Pages 不會更新。
