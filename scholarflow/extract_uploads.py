"""Parse authorized uploaded course materials inside the worker environment."""

def extract(uploads):
    import json, re, hashlib, io
    from pypdf import PdfReader
    from pptx import Presentation
    from docx import Document
    
    tasks = []
    for name, data in uploads.items():
        if name.lower().endswith(".json"):
            try:
                obj = json.loads(data)
                if isinstance(obj, dict) and obj.get("schema") == "scholarflow.task.v1":
                    tasks.append(obj)
            except (ValueError, UnicodeError):
                pass
    if len(tasks) != 1:
        raise ValueError("請上傳且僅上傳一份 ScholarFlow 任務 JSON")
    task = tasks[0]
    for key in ("courseId", "name", "school", "professor", "outline", "material"):
        if not isinstance(task.get(key), str):
            raise ValueError("任務欄位格式錯誤: " + key)
    warnings = []
    sources = []
    def add(label, text):
        text = str(text).strip()
        if text:
            sources.append((label, text))
    add("課程大綱", task["outline"])
    add("補充教材文字", task["material"])
    for name, data in uploads.items():
        if name.lower().endswith(".json"):
            continue
        if len(data) > 50*1024*1024:
            warnings.append(name + ": 超過 50 MB，未處理")
            continue
        try:
            ext = name.lower().rsplit(".", 1)[-1]
            if ext == "pdf":
                for i, page in enumerate(PdfReader(io.BytesIO(data)).pages, 1):
                    t = page.extract_text() or ""
                    if not t.strip():
                        warnings.append(f"{name} 第 {i} 頁無可擷取文字（未執行 OCR）")
                    add(f"{name} 第 {i} 頁", t)
            elif ext == "pptx":
                for i, slide in enumerate(Presentation(io.BytesIO(data)).slides, 1):
                    texts = [s.text for s in slide.shapes if s.has_text_frame]
                    add(f"{name} 第 {i} 張投影片", "\n".join(texts))
            elif ext == "docx":
                doc = Document(io.BytesIO(data))
                for i, para in enumerate(doc.paragraphs, 1):
                    add(f"{name} 第 {i} 段", para.text)
                for i, table in enumerate(doc.tables, 1):
                    add(f"{name} 表格 {i}", "\n".join(" | ".join(c.text for c in row.cells) for row in table.rows))
            elif ext in ("txt", "md"):
                add(name, data.decode("utf-8-sig"))
            else:
                warnings.append(name + ": 不支援的格式")
        except Exception as exc:
            warnings.append(f"{name}: 解析失敗 ({type(exc).__name__})")
    if not sources:
        raise ValueError("沒有可用的教材文字，請提供文字版教材")
    print(f"已讀取 {len(sources)} 個來源區段")
    print("\n".join(warnings[:30]))
    return task, sources, warnings
