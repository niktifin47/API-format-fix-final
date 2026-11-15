package com.niktifin47.apiformatfix

import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.text.PDFTextStripper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.charset.CharacterCodingException
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ApiFormatFixTest {
    @Test
    fun formatCapabilitiesDescribeAndroidInputAndOutputFormats() {
        val capabilities = ApiFormatFix.getFormatCapabilities()

        assertEquals(
            setOf(".md", ".cv", ".txt", ".docx", ".pdf"),
            capabilities.filterValues { it.canRead }.keys,
        )
        assertEquals(
            setOf(".md", ".cv", ".html", ".docx", ".pdf"),
            capabilities.filterValues { it.canWrite }.keys,
        )
        assertEquals(
            FormatCapability(".html", canRead = false, canWrite = true),
            capabilities[".html"],
        )
        assertThrows(UnsupportedOperationException::class.java) {
            (capabilities as MutableMap)[".custom"] =
                FormatCapability(".custom", canRead = true, canWrite = true)
        }
    }

    @Test
    fun textFormattingEscapesInputAndAppliesPreset() {
        val html = ApiFormatFix.formatText(
            "# <script>alert(1)</script>\n\n**Safe**",
            "md",
            "html",
            preset = "friendly",
        )

        assertTrue("<script>" !in html)
        assertTrue("&lt;script&gt;" in html)
        assertTrue("#00695c" in html)
        assertTrue("<strong>Safe</strong>" in html)
    }

    @Test
    fun docxBytesRoundTripThroughMarkdown() {
        val context = RuntimeEnvironment.getApplication()
        val source = "# Summary\n\n- First item"
        val docx = ApiFormatFix.formatContent(context, source, "md", "docx")
        val markdown = ApiFormatFix.formatContent(context, docx, "docx", "md")
            .toString(Charsets.UTF_8)

        assertTrue(docx.take(2).toByteArray().contentEquals(byteArrayOf(0x50, 0x4b)))
        assertEquals("# Summary\n\n- First item\n", markdown)
    }

    @Test
    fun pdfBytesRoundTripThroughTextExtraction() {
        val context = RuntimeEnvironment.getApplication()
        val source = "# Summary\n\n- First item".toByteArray()
        val pdf = ApiFormatFix.formatContent(context, source, "md", "pdf")
        val extracted = PDDocument.load(ByteArrayInputStream(pdf)).use(PDFTextStripper()::getText)
        val markdown = ApiFormatFix.formatContent(context, pdf, "pdf", "md")
            .toString(Charsets.UTF_8)

        assertTrue(String(pdf, 0, 4) == "%PDF")
        assertTrue("Summary" in extracted)
        assertTrue("First item" in extracted)
        assertTrue("Summary" in markdown)
        assertTrue("First item" in markdown)
    }

    @Test
    fun invalidFormatsAndPresetsFailExplicitly() {
        val context = RuntimeEnvironment.getApplication()
        assertThrows(CharacterCodingException::class.java) {
            ApiFormatFix.formatContent(
                context,
                byteArrayOf(0xc3.toByte(), 0x28),
                "md",
                "html",
            )
        }

        try {
            ApiFormatFix.formatContent(context, "text", "docx", "md")
            throw AssertionError("Expected text input for DOCX to fail")
        } catch (error: IllegalArgumentException) {
            assertTrue(error.message!!.contains("String input"))
        }

        try {
            ApiFormatFix.formatText("text", "md", "pdf")
            throw AssertionError("Expected unsupported text output to fail")
        } catch (error: IllegalArgumentException) {
            assertTrue(error.message!!.contains("formatContent"))
        }

        try {
            ApiFormatFix.formatText("text", "md", "html", preset = "unknown")
            throw AssertionError("Expected unknown preset to fail")
        } catch (error: IllegalArgumentException) {
            assertTrue(error.message!!.contains("Unknown preset"))
        }
    }

    @Test
    fun resourceLimitsRejectOversizedTextAndInputs() {
        val context = RuntimeEnvironment.getApplication()
        assertThrows(ResourceLimitException::class.java) {
            ApiFormatFix.formatContent(
                context,
                "A longer document".toByteArray(),
                "md",
                "html",
                resourceLimits = ResourceLimits(maxInputBytes = 4),
            )
        }
        assertThrows(ResourceLimitException::class.java) {
            ApiFormatFix.formatText(
                "A longer document",
                "md",
                "html",
                resourceLimits = ResourceLimits(maxTextChars = 4),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            ResourceLimits(maxTextChars = 0)
        }
    }

    @Test
    fun resourceLimitsRejectPdfPageCountAndExtractedText() {
        val context = RuntimeEnvironment.getApplication()
        val source = PDDocument().use { document ->
            document.addPage(PDPage())
            document.addPage(PDPage())
            ByteArrayOutputStream().also { document.save(it) }.toByteArray()
        }

        assertThrows(ResourceLimitException::class.java) {
            ApiFormatFix.formatContent(
                context,
                source,
                "pdf",
                "md",
                resourceLimits = ResourceLimits(maxPdfPages = 1),
            )
        }
        assertThrows(ResourceLimitException::class.java) {
            ApiFormatFix.formatContent(
                context,
                "# More than four characters".toByteArray(),
                "md",
                "pdf",
                resourceLimits = ResourceLimits(maxTextChars = 4),
            )
        }
        val textPdf = ApiFormatFix.formatContent(
            context,
            "More than four characters",
            "md",
            "pdf",
        )
        assertThrows(ResourceLimitException::class.java) {
            ApiFormatFix.formatContent(
                context,
                textPdf,
                "pdf",
                "md",
                resourceLimits = ResourceLimits(maxTextChars = 4),
            )
        }
    }

    @Test
    fun decompressedDocxLimitAndMalformedDocumentsHaveFormatDiagnostics() {
        val context = RuntimeEnvironment.getApplication()
        val validXml =
            """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Document text</w:t></w:r></w:p></w:body></w:document>"""
        val docx = docxWithDocumentXml(validXml)

        assertThrows(ResourceLimitException::class.java) {
            ApiFormatFix.formatContent(
                context,
                docx,
                "docx",
                "md",
                resourceLimits = ResourceLimits(maxDecompressedBytes = 32),
            )
        }
        val docxError = assertThrows(DocumentParseException::class.java) {
            ApiFormatFix.formatContent(
                context,
                docxWithDocumentXml("<broken"),
                "docx",
                "md",
            )
        }
        assertTrue(docxError.message!!.contains("Could not read DOCX document"))
        val externalEntityXml =
            """<!DOCTYPE w:document [<!ENTITY external SYSTEM "file:///etc/passwd">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&external;</w:t></w:r></w:p></w:body></w:document>"""
        assertThrows(DocumentParseException::class.java) {
            ApiFormatFix.formatContent(
                context,
                docxWithDocumentXml(externalEntityXml),
                "docx",
                "md",
            )
        }
        assertThrows(DocumentParseException::class.java) {
            ApiFormatFix.formatContent(context, "not a zip".toByteArray(), "docx", "md")
        }

        val pdfError = assertThrows(DocumentParseException::class.java) {
            ApiFormatFix.formatContent(context, "not a PDF".toByteArray(), "pdf", "md")
        }
        assertTrue(pdfError.message!!.contains("Could not read PDF document"))
    }

    @Test
    fun hiddenCharacterInspectionAndCleanupAreOptIn() {
        val context = RuntimeEnvironment.getApplication()
        val source = "safe\u2066secret\u2069\u00a0👩\u200d💻"

        val findings = ApiFormatFix.inspectText(source, "md")
        assertEquals(listOf("U+2066", "U+2069", "U+00A0"), findings.map { it.codepoint })
        assertEquals(source, ApiFormatFix.formatText(source, "md", "md").trimEnd())

        val cleaned = ApiFormatFix.formatContent(
            context,
            source,
            "md",
            "md",
            removeHiddenCharacters = true,
        ).toString(Charsets.UTF_8)
        assertEquals("safesecret 👩\u200d💻\n", cleaned)
        assertTrue(ApiFormatFix.inspectContent(context, source, "md").isNotEmpty())
    }

    @Test
    fun customTemplateAndColorsAreSupportedAndValidated() {
        val template = FormatTemplate("custom", "Georgia", 12f, 18f, "custom")
        val colors = FormatColorScheme("custom", "#111111", "#222222", "#333333")
        val html = ApiFormatFix.formatText(
            "A document.",
            "txt",
            "html",
            template,
            colors,
        )

        assertTrue("Georgia" in html)
        assertTrue("#222222" in html)

        try {
            ApiFormatFix.formatText(
                "A document.",
                "txt",
                "html",
                template,
                colors.copy(heading = "</style><script>"),
            )
            throw AssertionError("Expected unsafe custom colors to fail")
        } catch (error: IllegalArgumentException) {
            assertTrue(error.message!!.contains("six-digit hexadecimal"))
        }
    }

    private fun docxWithDocumentXml(xml: String): ByteArray =
        ByteArrayOutputStream().also { output ->
            ZipOutputStream(output).use { zip ->
                zip.putNextEntry(ZipEntry("word/document.xml"))
                zip.write(xml.toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
        }.toByteArray()
}
