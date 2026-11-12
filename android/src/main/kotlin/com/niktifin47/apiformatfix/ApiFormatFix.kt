package com.niktifin47.apiformatfix

import android.content.Context
import android.util.Xml
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDColor
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDDeviceRGB
import com.tom_roush.pdfbox.text.PDFTextStripper
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import kotlin.math.max
import kotlin.math.roundToInt
import org.xmlpull.v1.XmlPullParser

data class FormatTemplate(
    val name: String,
    val fontFamily: String,
    val fontSizePt: Float,
    val headingSizePt: Float,
    val colorScheme: String,
)

data class FormatColorScheme(
    val name: String,
    val text: String,
    val heading: String,
    val accent: String,
    val background: String = "#ffffff",
)

private data class DocumentBlock(val kind: String, val text: String)

private data class DocumentStyle(val template: FormatTemplate, val colors: FormatColorScheme)

object ApiFormatFix {
    private val supportedInputs = setOf(".md", ".cv", ".txt", ".docx", ".pdf")
    private val supportedOutputs = setOf(".md", ".cv", ".html", ".docx", ".pdf")
    private val textFormats = setOf(".md", ".cv", ".txt")
    private val headingPattern = Regex("^(#{1,6})\\s+(.+?)\\s*#*\\s*$")
    private val listPattern = Regex("^\\s*([-*+]|\\d+[.)])\\s+(.+?)\\s*$")
    private val fontPattern = Regex("[A-Za-z0-9 ,'-]+")
    private val colorPattern = Regex("#[0-9a-fA-F]{6}")
    private const val WORD_NAMESPACE =
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

    val templates = mapOf(
        "formal" to FormatTemplate("formal", "Times New Roman", 11f, 16f, "navy"),
        "friendly" to FormatTemplate("friendly", "Arial", 11f, 16f, "teal"),
    )

    val colorSchemes = mapOf(
        "navy" to FormatColorScheme("navy", "#202124", "#17365d", "#345f8c"),
        "teal" to FormatColorScheme("teal", "#263238", "#00695c", "#ef6c57"),
    )

    @JvmStatic
    fun formatText(
        inputData: String,
        inputFormat: String,
        outputFormat: String,
        preset: String = "formal",
        colorScheme: String? = null,
    ): String = formatTextWithStyle(inputData, inputFormat, outputFormat, resolveStyle(preset, colorScheme))

    @JvmStatic
    fun formatText(
        inputData: String,
        inputFormat: String,
        outputFormat: String,
        preset: FormatTemplate,
        colorScheme: FormatColorScheme? = null,
    ): String = formatTextWithStyle(
        inputData,
        inputFormat,
        outputFormat,
        resolveStyle(preset, colorScheme),
    )

    private fun formatTextWithStyle(
        inputData: String,
        inputFormat: String,
        outputFormat: String,
        style: DocumentStyle,
    ): String {
        val inputSuffix = normalizeSuffix(inputFormat)
        val outputSuffix = normalizeSuffix(outputFormat)
        require(inputSuffix in textFormats) {
            "Text input supports only .md, .cv, and .txt formats."
        }
        require(outputSuffix in setOf(".md", ".cv", ".html")) {
            "Text output supports only .md, .cv, and .html formats; use formatContent for DOCX/PDF."
        }
        val document = parseMarkdown(inputData)
        return renderText(document, outputSuffix, style)
    }

    @JvmStatic
    fun formatContent(
        context: Context,
        inputData: String,
        inputFormat: String,
        outputFormat: String,
        preset: String = "formal",
        colorScheme: String? = null,
    ): ByteArray {
        require(normalizeSuffix(inputFormat) in textFormats) {
            "String input supports only .md, .cv, and .txt formats."
        }
        return formatContent(
            context,
            inputData.toByteArray(Charsets.UTF_8),
            inputFormat,
            outputFormat,
            preset,
            colorScheme,
        )
    }

    @JvmStatic
    fun formatContent(
        context: Context,
        inputData: String,
        inputFormat: String,
        outputFormat: String,
        preset: FormatTemplate,
        colorScheme: FormatColorScheme? = null,
    ): ByteArray {
        require(normalizeSuffix(inputFormat) in textFormats) {
            "String input supports only .md, .cv, and .txt formats."
        }
        return formatContent(
            context,
            inputData.toByteArray(Charsets.UTF_8),
            inputFormat,
            outputFormat,
            preset,
            colorScheme,
        )
    }

    @JvmStatic
    fun formatContent(
        context: Context,
        inputData: ByteArray,
        inputFormat: String,
        outputFormat: String,
        preset: String = "formal",
        colorScheme: String? = null,
    ): ByteArray = formatContentWithStyle(
        context,
        inputData,
        inputFormat,
        outputFormat,
        resolveStyle(preset, colorScheme),
    )

    @JvmStatic
    fun formatContent(
        context: Context,
        inputData: ByteArray,
        inputFormat: String,
        outputFormat: String,
        preset: FormatTemplate,
        colorScheme: FormatColorScheme? = null,
    ): ByteArray = formatContentWithStyle(
        context,
        inputData,
        inputFormat,
        outputFormat,
        resolveStyle(preset, colorScheme),
    )

    private fun formatContentWithStyle(
        context: Context,
        inputData: ByteArray,
        inputFormat: String,
        outputFormat: String,
        style: DocumentStyle,
    ): ByteArray {
        val inputSuffix = normalizeSuffix(inputFormat)
        val outputSuffix = normalizeSuffix(outputFormat)
        require(inputSuffix in supportedInputs) {
            "Unsupported input format ${inputSuffix.ifEmpty { "(no extension)" }}."
        }
        require(outputSuffix in supportedOutputs) {
            "Unsupported output format ${outputSuffix.ifEmpty { "(no extension)" }}."
        }

        val document = when (inputSuffix) {
            in textFormats -> parseMarkdown(decodeUtf8(inputData))
            ".docx" -> parseDocx(inputData)
            else -> parsePdf(context, inputData)
        }
        return when (outputSuffix) {
            ".md", ".cv" -> renderMarkdown(document).toByteArray(Charsets.UTF_8)
            ".html" -> renderHtml(document, style).toByteArray(Charsets.UTF_8)
            ".docx" -> renderDocx(document, style)
            else -> renderPdf(context, document, style)
        }
    }

    private fun normalizeSuffix(format: String): String {
        val normalized = format.lowercase()
        return if (normalized.isEmpty() || normalized.startsWith(".")) normalized else ".$normalized"
    }

    private fun decodeUtf8(data: ByteArray): String = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(data))
        .toString()

    private fun resolveStyle(preset: String, colorScheme: String?): DocumentStyle {
        val template = templates[preset] ?: throw IllegalArgumentException(
            "Unknown preset '$preset'. Choose from: ${templates.keys.joinToString()}",
        )
        val colors = colorSchemes[colorScheme ?: template.colorScheme]
            ?: throw IllegalArgumentException(
                "Unknown color scheme '${colorScheme ?: template.colorScheme}'. " +
                    "Choose from: ${colorSchemes.keys.joinToString()}",
            )
        return resolveStyle(template, colors)
    }

    private fun resolveStyle(
        template: FormatTemplate,
        colors: FormatColorScheme?,
    ): DocumentStyle {
        require(fontPattern.matches(template.fontFamily)) { "Invalid font family." }
        require(template.fontSizePt.isFinite() && template.fontSizePt > 0) {
            "Font size must be a positive finite number."
        }
        require(template.headingSizePt.isFinite() && template.headingSizePt > 0) {
            "Heading size must be a positive finite number."
        }
        val selectedColors = colors ?: colorSchemes[template.colorScheme]
            ?: throw IllegalArgumentException(
                "Unknown color scheme '${template.colorScheme}'. " +
                    "Choose from: ${colorSchemes.keys.joinToString()}",
            )
        require(
            listOf(
                selectedColors.text,
                selectedColors.heading,
                selectedColors.accent,
                selectedColors.background,
            )
                .all(colorPattern::matches),
        ) { "Color values must be six-digit hexadecimal colors, such as #17365d." }
        return DocumentStyle(template, selectedColors)
    }

    private fun parseMarkdown(text: String): List<DocumentBlock> {
        val blocks = mutableListOf<DocumentBlock>()
        val paragraph = mutableListOf<String>()

        fun flushParagraph() {
            if (paragraph.isNotEmpty()) {
                blocks += DocumentBlock("paragraph", paragraph.joinToString(" "))
                paragraph.clear()
            }
        }

        for (line in text.lines()) {
            val stripped = line.trim()
            if (stripped.isEmpty()) {
                flushParagraph()
                continue
            }
            val heading = headingPattern.matchEntire(stripped)
            if (heading != null) {
                flushParagraph()
                blocks += DocumentBlock("heading${heading.groupValues[1].length}", heading.groupValues[2])
                continue
            }
            val listItem = listPattern.matchEntire(line)
            if (listItem != null) {
                flushParagraph()
                val marker = listItem.groupValues[1]
                val kind = if (marker.first().isDigit()) "ordered_item" else "list_item"
                blocks += DocumentBlock(kind, listItem.groupValues[2])
                continue
            }
            paragraph += stripped
        }
        flushParagraph()
        return blocks
    }

    private fun renderText(document: List<DocumentBlock>, suffix: String, style: DocumentStyle): String =
        if (suffix == ".html") renderHtml(document, style) else renderMarkdown(document)

    private fun renderMarkdown(document: List<DocumentBlock>): String {
        val output = mutableListOf<String>()
        var listKind: String? = null
        var orderedNumber = 0
        for (block in document) {
            if (block.kind == "list_item" || block.kind == "ordered_item") {
                if (listKind != block.kind) {
                    if (listKind != null) output += ""
                    listKind = block.kind
                    orderedNumber = 0
                }
                if (block.kind == "ordered_item") {
                    orderedNumber++
                    output += "$orderedNumber. ${block.text}"
                } else {
                    output += "- ${block.text}"
                }
                continue
            }
            if (listKind != null) {
                output += ""
                listKind = null
            }
            if (block.kind.startsWith("heading")) {
                val level = block.kind.removePrefix("heading").toInt()
                output += "${"#".repeat(level)} ${block.text}"
                output += ""
            } else {
                output += block.text
                output += ""
            }
        }
        return output.joinToString("\n").trimEnd().let { if (it.isEmpty()) "" else "$it\n" }
    }

    private fun renderHtml(document: List<DocumentBlock>, style: DocumentStyle): String {
        val output = mutableListOf<String>()
        var listKind: String? = null
        for (block in document) {
            if (block.kind == "list_item" || block.kind == "ordered_item") {
                val nextKind = if (block.kind == "ordered_item") "ol" else "ul"
                if (listKind != nextKind) {
                    listKind?.let { output += "</$it>" }
                    output += "<$nextKind>"
                    listKind = nextKind
                }
                output += "<li>${inlineHtml(block.text)}</li>"
                continue
            }
            listKind?.let {
                output += "</$it>"
                listKind = null
            }
            if (block.kind.startsWith("heading")) {
                val level = block.kind.removePrefix("heading").toInt()
                output += "<h$level>${inlineHtml(block.text)}</h$level>"
            } else {
                output += "<p>${inlineHtml(block.text)}</p>"
            }
        }
        listKind?.let { output += "</$it>" }
        val template = style.template
        val colors = style.colors
        return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Formatted document</title>
  <style>
    body { background: ${colors.background}; color: ${colors.text}; font-family: ${template.fontFamily}, sans-serif;
           font-size: ${template.fontSizePt}pt; line-height: 1.5; max-width: 760px; margin: 3rem auto; padding: 0 1rem; }
    h1, h2, h3, h4, h5, h6 { color: ${colors.heading}; font-family: ${template.fontFamily}, sans-serif; }
    a, strong { color: ${colors.accent}; }
    code { background: #f3f4f6; padding: 0.1em 0.25em; }
  </style>
</head>
<body>
${output.joinToString("\n")}
</body>
</html>
"""
    }

    private fun inlineHtml(value: String): String {
        val escaped = value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#x27;")
        return escaped
            .replace(Regex("\\*\\*(.+?)\\*\\*"), "<strong>$1</strong>")
            .replace(Regex("\\*(.+?)\\*"), "<em>$1</em>")
            .replace(Regex("`(.+?)`"), "<code>$1</code>")
    }

    private fun parseDocx(data: ByteArray): List<DocumentBlock> {
        var documentXml: ByteArray? = null
        ZipInputStream(ByteArrayInputStream(data)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (entry.name == "word/document.xml") {
                    documentXml = zip.readBytes()
                    break
                }
            }
        }
        val xml = documentXml ?: throw IllegalArgumentException("DOCX archive has no word/document.xml.")
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_DOCDECL, false)
        parser.setInput(ByteArrayInputStream(xml), "UTF-8")
        val blocks = mutableListOf<DocumentBlock>()
        var insideParagraph = false
        var hasNumbering = false
        var paragraphStyle = ""
        var paragraphText = StringBuilder()
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> when (parser.name) {
                    "p" -> {
                        insideParagraph = true
                        hasNumbering = false
                        paragraphStyle = ""
                        paragraphText = StringBuilder()
                    }
                    "pStyle" -> if (insideParagraph) {
                        paragraphStyle = parser.getAttributeValue(WORD_NAMESPACE, "val")
                            ?: parser.getAttributeValue(null, "val")
                            ?: ""
                    }
                    "numPr" -> if (insideParagraph) hasNumbering = true
                    "t" -> if (insideParagraph) paragraphText.append(parser.nextText())
                }
                XmlPullParser.END_TAG -> if (parser.name == "p" && insideParagraph) {
                    val heading = Regex("heading\\s*(\\d+)", RegexOption.IGNORE_CASE)
                        .find(paragraphStyle)
                    val kind = when {
                        heading != null -> "heading${heading.groupValues[1].toInt().coerceIn(1, 6)}"
                        hasNumbering || paragraphStyle.contains("list", ignoreCase = true) -> "list_item"
                        else -> "paragraph"
                    }
                    if (paragraphText.isNotEmpty()) blocks += DocumentBlock(kind, paragraphText.toString())
                    insideParagraph = false
                }
            }
            event = parser.next()
        }
        return blocks
    }

    private fun renderDocx(document: List<DocumentBlock>, style: DocumentStyle): ByteArray {
        val output = ByteArrayOutputStream()
        ZipOutputStream(output).use { zip ->
            zipEntry(zip, "[Content_Types].xml", contentTypesXml)
            zipEntry(zip, "_rels/.rels", rootRelationshipsXml)
            zipEntry(zip, "word/document.xml", documentXml(document))
            zipEntry(zip, "word/styles.xml", stylesXml(style))
            zipEntry(zip, "word/numbering.xml", numberingXml)
            zipEntry(zip, "word/_rels/document.xml.rels", documentRelationshipsXml)
        }
        return output.toByteArray()
    }

    private fun documentXml(document: List<DocumentBlock>): String {
        val paragraphs = document.joinToString("") { block ->
            val properties = when {
                block.kind.startsWith("heading") ->
                    "<w:pPr><w:pStyle w:val=\"Heading${block.kind.removePrefix("heading")}\"/></w:pPr>"
                block.kind == "list_item" || block.kind == "ordered_item" -> {
                    val numId = if (block.kind == "ordered_item") 2 else 1
                    "<w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"$numId\"/>" +
                        "</w:numPr></w:pPr>"
                }
                else -> ""
            }
            "<w:p>$properties<w:r><w:t xml:space=\"preserve\">${xmlEscape(block.text)}</w:t></w:r></w:p>"
        }
        return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="$WORD_NAMESPACE"><w:body>$paragraphs
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr>
</w:body></w:document>"""
    }

    private fun stylesXml(style: DocumentStyle): String {
        val template = style.template
        val normalColor = style.colors.text.removePrefix("#")
        val headingColor = style.colors.heading.removePrefix("#")
        val headings = (1..6).joinToString("") { level ->
            val size = max(template.headingSizePt - 2f * (level - 1), template.fontSizePt)
            """<w:style w:type="paragraph" w:styleId="Heading$level"><w:name w:val="Heading $level"/>
<w:rPr><w:rFonts w:ascii="${xmlEscape(template.fontFamily)}" w:hAnsi="${xmlEscape(template.fontFamily)}"/>
<w:b/><w:color w:val="$headingColor"/><w:sz w:val="${(size * 2).roundToInt()}"/></w:rPr></w:style>"""
        }
        return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="$WORD_NAMESPACE">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${xmlEscape(template.fontFamily)}" w:hAnsi="${xmlEscape(template.fontFamily)}"/>
<w:color w:val="$normalColor"/><w:sz w:val="${(template.fontSizePt * 2).roundToInt()}"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
$headings
</w:styles>"""
    }

    private fun zipEntry(zip: ZipOutputStream, name: String, content: String) {
        zip.putNextEntry(ZipEntry(name))
        zip.write(content.toByteArray(Charsets.UTF_8))
        zip.closeEntry()
    }

    private fun parsePdf(context: Context, data: ByteArray): List<DocumentBlock> {
        PDFBoxResourceLoader.init(context.applicationContext)
        PDDocument.load(ByteArrayInputStream(data)).use { pdf ->
            return parseMarkdown(PDFTextStripper().getText(pdf))
        }
    }

    private fun renderPdf(context: Context, document: List<DocumentBlock>, style: DocumentStyle): ByteArray {
        PDFBoxResourceLoader.init(context.applicationContext)
        val output = ByteArrayOutputStream()
        PDDocument().use { pdf ->
            var page = PDPage(PDRectangle.LETTER)
            pdf.addPage(page)
            var stream = PDPageContentStream(pdf, page)
            var y = page.mediaBox.height - 54f
            var orderedNumber = 0

            fun nextPage() {
                stream.close()
                page = PDPage(PDRectangle.LETTER)
                pdf.addPage(page)
                stream = PDPageContentStream(pdf, page)
                y = page.mediaBox.height - 54f
            }

            for (block in document) {
                val isHeading = block.kind.startsWith("heading")
                val font = when {
                    isHeading && style.template.fontFamily.contains("times", ignoreCase = true) ->
                        PDType1Font.TIMES_BOLD
                    isHeading -> PDType1Font.HELVETICA_BOLD
                    style.template.fontFamily.contains("times", ignoreCase = true) ->
                        PDType1Font.TIMES_ROMAN
                    else -> PDType1Font.HELVETICA
                }
                val size = if (isHeading) {
                    val level = block.kind.removePrefix("heading").toInt()
                    max(style.template.headingSizePt - 2f * (level - 1), style.template.fontSizePt)
                } else {
                    style.template.fontSizePt
                }
                val color = if (isHeading) style.colors.heading else style.colors.text
                val rgb = color.removePrefix("#").chunked(2).map { it.toInt(16) }
                val prefix = when (block.kind) {
                    "list_item" -> {
                        orderedNumber = 0
                        "- "
                    }
                    "ordered_item" -> "${++orderedNumber}. "
                    else -> {
                        orderedNumber = 0
                        ""
                    }
                }
                val lines = wrapText(prefix + block.text, font, size, page.mediaBox.width - 108f)
                for (line in lines) {
                    val lineHeight = size * 1.4f
                    if (y - lineHeight < 54f) nextPage()
                    stream.beginText()
                    stream.setFont(font, size)
                    stream.setNonStrokingColor(
                        PDColor(rgb.map { it / 255f }.toFloatArray(), PDDeviceRGB.INSTANCE),
                    )
                    stream.newLineAtOffset(54f, y)
                    stream.showText(line)
                    stream.endText()
                    y -= lineHeight
                }
                y -= if (isHeading) 6f else 3f
            }
            stream.close()
            pdf.save(output)
        }
        return output.toByteArray()
    }

    private fun wrapText(text: String, font: PDType1Font, size: Float, maxWidth: Float): List<String> {
        val lines = mutableListOf<String>()
        var line = ""
        for (word in text.split(Regex("\\s+"))) {
            val candidate = if (line.isEmpty()) word else "$line $word"
            if (line.isNotEmpty() && font.getStringWidth(candidate) * size / 1000f > maxWidth) {
                lines += line
                line = word
            } else {
                line = candidate
            }
        }
        if (line.isNotEmpty()) lines += line
        return lines.ifEmpty { listOf("") }
    }

    private fun xmlEscape(value: String): String = value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&apos;")

    private val contentTypesXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>"""

    private val rootRelationshipsXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

    private val documentRelationshipsXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>"""

    private val numberingXml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="$WORD_NAMESPACE">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>"""
}
