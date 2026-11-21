from api_format_fix import parse_markdown, render_document


def test_parse_markdown_blocks_headings_paragraphs_and_lists():
    document = parse_markdown("# Resume\n\nTwo lines\ncontinued.\n\n- First\n- Second")

    assert [(block.kind, block.text) for block in document.blocks] == [
        ("heading1", "Resume"),
        ("paragraph", "Two lines continued."),
        ("list_item", "First"),
        ("list_item", "Second"),
    ]


def test_markdown_rendering_round_trips_supported_blocks():
    document = parse_markdown("# Profile\n\nExperienced engineer.\n\n- Python")

    assert render_document(document, ".md") == "# Profile\n\nExperienced engineer.\n\n- Python\n"


def test_ordered_lists_keep_ordered_markers():
    document = parse_markdown("1. First\n2) Second")

    assert render_document(document, ".md") == "1. First\n2. Second\n"


def test_html_escapes_document_content_and_uses_selected_palette():
    document = parse_markdown("# <script>alert(1)</script>\n\n**Safe**")
    rendered = render_document(document, "html", preset="friendly")

    assert "<script>" not in rendered
    assert "&lt;script&gt;" in rendered
    assert "#00695c" in rendered
    assert "<strong>Safe</strong>" in rendered
