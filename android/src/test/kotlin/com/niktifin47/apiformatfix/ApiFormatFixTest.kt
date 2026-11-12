package com.niktifin47.apiformatfix

import com.tom_roush.pdfbox.pdmodel.PDDocument
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
import java.nio.charset.CharacterCodingException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ApiFormatFixTest {
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
}
