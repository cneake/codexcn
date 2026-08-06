use std::io::Read;

/// 解析 PDF 文件，返回提取的文本内容
pub fn parse_pdf(path: &str) -> Result<String, String> {
    let doc = lopdf::Document::load(path).map_err(|e| format!("PDF 加载失败: {}", e))?;

    let mut all_text = String::new();
    let pages: Vec<u32> = doc.get_pages().keys().cloned().collect();

    for page_id in pages {
        if let Ok(content) = doc.extract_text(&[page_id]) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                all_text.push_str(trimmed);
                all_text.push_str("\n\n");
            }
        }
    }

    if all_text.trim().is_empty() {
        return Err("PDF 中未提取到可读文本（可能是扫描图片 PDF）".to_string());
    }

    // 截断到合理大小
    const MAX_CHARS: usize = 8000;
    if all_text.len() > MAX_CHARS {
        all_text.truncate(MAX_CHARS);
        if !all_text.ends_with("\n\n") {
            if let Some(pos) = all_text.rfind("\n\n") {
                all_text.truncate(pos);
            }
        }
        all_text.push_str("\n\n[... 文件过长已截断 ...]");
    }

    Ok(all_text)
}

/// 解析 DOCX 文件，返回提取的文本内容
pub fn parse_docx(path: &str) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("文件打开失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("ZIP 解析失败: {}", e))?;

    // 查找 word/document.xml
    let doc_xml_idx = archive
        .file_names()
        .position(|name| name == "word/document.xml")
        .ok_or("DOCX 文件中未找到 word/document.xml（文件可能损坏）")?;

    let mut doc_xml = String::new();
    archive
        .by_index(doc_xml_idx)
        .map_err(|e| format!("读取 document.xml 失败: {}", e))?
        .read_to_string(&mut doc_xml)
        .map_err(|e| format!("document.xml 读取失败: {}", e))?;

    // 提取 XML 中的所有 <w:t> 标签文本
    let text = extract_docx_text(&doc_xml);

    if text.trim().is_empty() {
        return Err("DOCX 中未提取到文本内容".to_string());
    }

    // 截断
    const MAX_CHARS: usize = 8000;
    if text.len() > MAX_CHARS {
        let truncated = &text[..MAX_CHARS];
        if let Some(pos) = truncated.rfind("\n\n") {
            return Ok(format!("{}\n\n[... 文件过长已截断 ...]", &truncated[..pos]));
        }
        return Ok(format!("{}\n\n[... 文件过长已截断 ...]", truncated));
    }

    Ok(text)
}

/// 解析 PPTX 文件，返回所有幻灯片的文本内容
pub fn parse_pptx(path: &str) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("文件打开失败: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("ZIP 解析失败: {}", e))?;

    let mut all_text = String::new();
    let slide_count = archive.len();

    // 按顺序找所有幻灯片
    let mut slide_names: Vec<String> = archive
        .file_names()
        .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
        .map(|n| n.to_string())
        .collect();
    slide_names.sort(); // 确保按顺序

    if slide_names.is_empty() {
        return Err("PPTX 文件中未找到幻灯片（文件可能损坏）".to_string());
    }

    for (idx, slide_name) in slide_names.iter().enumerate() {
        let idx_in_zip = archive
            .file_names()
            .position(|n| n == slide_name)
            .ok_or_else(|| format!("找不到幻灯片: {}", slide_name))?;

        let mut slide_xml = String::new();
        archive
            .by_index(idx_in_zip)
            .map_err(|e| format!("读取幻灯片失败: {}", e))?
            .read_to_string(&mut slide_xml)
            .map_err(|e| format!("幻灯片 XML 读取失败: {}", e))?;

        let slide_text = extract_pptx_slide_text(&slide_xml);
        if !slide_text.trim().is_empty() {
            all_text.push_str(&format!("─── 第 {} 张 ───\n", idx + 1));
            all_text.push_str(&slide_text);
            all_text.push_str("\n\n");
        }
    }

    if all_text.trim().is_empty() {
        return Err("PPTX 中未提取到文本内容（可能是纯图片幻灯片）".to_string());
    }

    // 截断
    const MAX_CHARS: usize = 8000;
    if all_text.len() > MAX_CHARS {
        all_text.truncate(MAX_CHARS);
        if let Some(pos) = all_text.rfind("─── 第") {
            all_text.truncate(pos);
        }
        all_text.push_str("\n\n[... 文件过长已截断 ...]");
    }

    Ok(format!(
        "📊 PPTX（共 {} 张幻灯片）\n\n{}",
        slide_count, all_text
    ))
}

/// 从 DOCX XML 中提取文本内容（处理 <w:t> 标签和 </w:p> 换行）
fn extract_docx_text(xml: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = xml.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // 检测 </w:p> 段落结束 → 换行
        if chars[i] == '<'
            && i + 5 < len
            && chars[i + 1] == '/'
            && chars[i + 2] == 'w'
            && chars[i + 3] == ':'
            && chars[i + 4] == 'p'
            && chars[i + 5] == '>'
        {
            result.push('\n');
            i += 6;
            continue;
        }

        // 检测 <w:t> 文本标签
        if i + 4 < len
            && chars[i] == '<'
            && chars[i + 1] == 'w'
            && chars[i + 2] == ':'
            && chars[i + 3] == 't'
        {
            // 找到标签结束 >
            let mut j = i + 4;
            while j < len && chars[j] != '>' {
                j += 1;
            }
            if j < len && chars[j] == '>' {
                // 自闭合 <w:t ... /> 跳过
                if j > 0 && chars[j - 1] == '/' {
                    i = j + 1;
                    continue;
                }
                // 提取标签之间的文本
                let start = j + 1;
                let mut end = start;
                while end < len
                    && !(chars[end] == '<'
                        && end + 5 < len
                        && chars[end + 1] == '/'
                        && chars[end + 2] == 'w'
                        && chars[end + 3] == ':'
                        && chars[end + 4] == 't'
                        && chars[end + 5] == '>')
                {
                    end += 1;
                }
                let text: String = chars[start..end].iter().collect();
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    result.push_str(trimmed);
                }
                i = end + 6;
                continue;
            }
        }
        i += 1;
    }

    result.trim().to_string()
}

/// 从 PPTX 单张幻灯片 XML 中提取文本（处理 <a:t> 标签）
fn extract_pptx_slide_text(xml: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = xml.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // 检测 </a:p> 段落结束 → 换行
        if chars[i] == '<' && i + 5 < len && chars[i + 1] == '/' && chars[i + 2] == 'a'
            && chars[i + 3] == ':' && chars[i + 4] == 'p' && chars[i + 5] == '>'
        {
            result.push('\n');
            i += 4;
            continue;
        }

        // 检测 <a:t> 文本标签
        if i + 3 < len && chars[i] == '<' && chars[i + 1] == 'a' && chars[i + 2] == ':'
            && chars[i + 3] == 't'
        {
            let mut j = i + 4;
            while j < len && chars[j] != '>' {
                j += 1;
            }
            if j < len && chars[j] == '>' {
                if j > 0 && chars[j - 1] == '/' {
                    // 自闭合 <a:t ... />
                    i = j + 1;
                    continue;
                }
                let start = j + 1;
                let mut end = start;
                while end < len
                    && !(chars[end] == '<' && end + 5 < len && chars[end + 1] == '/' && chars[end + 2] == 'a'
                        && chars[end + 3] == ':' && chars[end + 4] == 't' && chars[end + 5] == '>')
                {
                    end += 1;
                }
                let text: String = chars[start..end].iter().collect();
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    result.push_str(trimmed);
                }
                i = end + 6;
                continue;
            }
        }
        i += 1;
    }

    result.trim().to_string()
}
/// 解析 XLSX 文件，返回所有表格文本内容
pub fn parse_xlsx(path: &str) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("文件打开失败: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("ZIP 解析失败: {}", e))?;

    let sheet_names = read_sheet_names(&mut archive);
    let shared_strings = read_shared_strings(&mut archive);

    let mut output = String::new();
    for sheet_idx in 1..=255u16 {
        let sheet_path = format!("xl/worksheets/sheet{}.xml", sheet_idx);
        if !archive.file_names().any(|n| n == sheet_path) { break; }
        let idx = archive.file_names().position(|n| n == sheet_path).unwrap();
        let mut xml = String::new();
        archive.by_index(idx)
            .map_err(|e| format!("读取工作表失败: {}", e))?
            .read_to_string(&mut xml)
            .map_err(|e| format!("工作表 XML 读取失败: {}", e))?;

        let name = sheet_names.as_ref()
            .and_then(|names| names.iter().find(|(sid, _)| *sid == sheet_idx as usize))
            .map(|(_, n)| n.as_str())
            .unwrap_or("");

        if !name.is_empty() {
            output.push_str(&format!("─── 表格: {} ───\n", name));
        } else {
            output.push_str(&format!("─── 第 {} 个工作表 ───\n", sheet_idx));
        }

        let ss = shared_strings.as_deref().unwrap_or(&[]);
        output.push_str(&extract_xlsx_sheet_text(&xml, ss));
        output.push_str("\n\n");
    }

    if output.trim().is_empty() {
        return Err("XLSX 中未提取到文本内容".to_string());
    }
    const MAX_CHARS: usize = 8000;
    if output.len() > MAX_CHARS {
        output.truncate(MAX_CHARS);
        if let Some(pos) = output.rfind("───") { output.truncate(pos); }
        output.push_str("\n\n[... 文件过长已截断 ...]");
    }
    Ok(output)
}

fn read_sheet_names(archive: &mut zip::ZipArchive<std::fs::File>) -> Option<Vec<(usize, String)>> {
    let idx = archive.file_names().position(|n| n == "xl/workbook.xml")?;
    let mut xml = String::new();
    archive.by_index(idx).ok()?.read_to_string(&mut xml).ok()?;
    let chars: Vec<char> = xml.chars().collect();
    let n = chars.len();
    let mut i = 0;
    let mut r = Vec::new();
    while i < n {
        if chars[i] == '<' && i + 6 < n && chars[i+1..=i+6].iter().collect::<String>() == "sheet " {
            let mut end = i;
            while end < n && chars[end] != '>' { end += 1; }
            if end < n {
                let tag: String = chars[i..=end].iter().collect();
                let p: Vec<&str> = tag.split('"').collect();
                if let Some(ok) = p.get(1).and_then(|s| s.parse::<usize>().ok()) {
                    r.push((ok, p.get(5).map(|s| xml_unescape(s)).unwrap_or_default()));
                }
            }
        }
        i += 1;
    }
    Some(r)
}

fn read_shared_strings(archive: &mut zip::ZipArchive<std::fs::File>) -> Option<Vec<String>> {
    let idx = archive.file_names().position(|n| n == "xl/sharedStrings.xml")?;
    let mut xml = String::new();
    archive.by_index(idx).ok()?.read_to_string(&mut xml).ok()?;
    let chars: Vec<char> = xml.chars().collect();
    let n = chars.len();
    let mut i = 0;
    let mut strings = Vec::new();
    while i < n {
        if chars[i] == '<' && i + 3 < n && chars[i+1] == 's' && chars[i+2] == 'i'
            && (chars[i+3] == '>' || chars[i+3].is_whitespace())
        {
            let mut j = i + 4;
            while j < n && chars[j] != '>' { j += 1; }
            j += 1;
            let mut text = String::new();
            loop {
                if j + 4 < n && chars[j] == '<' && chars[j+1] == '/' && chars[j+2] == 's' && chars[j+3] == 'i' && chars[j+4] == '>' { break; }
                if j + 2 < n && chars[j] == '<' && chars[j+1] == 't' && (chars[j+2] == '>' || chars[j+2].is_whitespace()) {
                    let mut te = j + 2;
                    while te < n && chars[te] != '>' { te += 1; }
                    let cs = te + 1; let mut ce = cs;
                    while ce + 3 < n && !(chars[ce] == '<' && chars[ce+1] == '/' && chars[ce+2] == 't' && chars[ce+3] == '>') { ce += 1; }
                    text.push_str(&xml_unescape(&chars[cs..ce].iter().collect::<String>()));
                    j = ce + 4; continue;
                }
                j += 1;
                if j >= n { break; }
            }
            strings.push(text);
        }
        i += 1;
    }
    Some(strings)
}

fn extract_xlsx_sheet_text(xml: &str, shared_strings: &[String]) -> String {
    let chars: Vec<char> = xml.chars().collect();
    let n = chars.len();
    let mut i = 0;
    let mut output = String::new();
    while i < n {
        if chars[i] == '<' && i + 4 < n && chars[i+1] == 'r' && chars[i+2] == 'o' && chars[i+3] == 'w' {
            let mut j = i + 4;
            while j < n && chars[j] != '>' { j += 1; }
            if j >= n { i += 1; continue; }
            j += 1;
            let mut in_cell = false;
            let mut cell_val = String::new();
            let mut is_ss = false;
            while j < n {
                if j + 5 < n && chars[j] == '<' && chars[j+1] == '/' && chars[j+2] == 'r' && chars[j+3] == 'o' && chars[j+4] == 'w' && chars[j+5] == '>' { break; }
                if j + 2 < n && chars[j] == '<' && chars[j+1] == 'c' {
                    in_cell = true; cell_val.clear(); is_ss = false;
                    let mut ce = j + 2;
                    while ce < n && chars[ce] != '>' { ce += 1; }
                    if ce < n {
                        let tag: String = chars[j..=ce].iter().collect();
                        let p: Vec<&str> = tag.split('"').collect();
                        for k in 1..p.len() {
                            if k > 1 && p.get(k-1).copied().unwrap_or("").ends_with("t=") && p[k] == "s" { is_ss = true; }
                        }
                    }
                    j = ce + 1; continue;
                }
                if in_cell {
                    if j + 3 < n && chars[j] == '<' && chars[j+1] == '/' && chars[j+2] == 'c' && chars[j+3] == '>' {
                        if !cell_val.is_empty() {
                            let r = if is_ss {
                                cell_val.trim().parse::<usize>().ok().and_then(|idx| shared_strings.get(idx)).map(|s| s.as_str()).unwrap_or("")
                            } else { &cell_val };
                            let r = r.trim();
                            if !r.is_empty() { output.push_str(r); output.push('\t'); }
                        }
                        in_cell = false; j += 4; continue;
                    }
                    if j + 2 < n && chars[j] == '<' && chars[j+1] == 'v' && (chars[j+2] == '>' || chars[j+2].is_whitespace()) {
                        let mut vs = j + 2;
                        while vs < n && chars[vs] != '>' { vs += 1; }
                        if vs < n {
                            let cs = vs + 1; let mut ce = cs;
                            while ce + 3 < n && !(chars[ce] == '<' && chars[ce+1] == '/' && chars[ce+2] == 'v' && chars[ce+3] == '>') { ce += 1; }
                            cell_val = chars[cs..ce].iter().collect();
                            j = ce + 4; continue;
                        }
                    }
                    if j + 2 < n && chars[j] == '<' && chars[j+1] == 't' && (chars[j+2] == '>' || chars[j+2].is_whitespace()) {
                        let mut ts = j + 2;
                        while ts < n && chars[ts] != '>' { ts += 1; }
                        if ts < n {
                            let cs = ts + 1; let mut ce = cs;
                            while ce + 3 < n && !(chars[ce] == '<' && chars[ce+1] == '/' && chars[ce+2] == 't' && chars[ce+3] == '>') { ce += 1; }
                            cell_val = xml_unescape(&chars[cs..ce].iter().collect::<String>());
                            j = ce + 4; continue;
                        }
                    }
                }
                j += 1;
            }
            output.push('\n');
        }
        i += 1;
    }
    output.trim().to_string()
}


fn xml_unescape(s: &str) -> String {
    s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
     .replace("&quot;", "\"").replace("&apos;", "'")
     .replace("&#10;", "\n").replace("&#13;", "\r")
}
