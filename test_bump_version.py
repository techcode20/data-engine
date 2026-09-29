from bump_version import bump_patch


def test_bump_patch_increments_patch_only():
    text = '[project]\nname = "data-engine"\nversion = "0.1.0"\n'
    new_text, new_version = bump_patch(text)
    assert new_version == "0.1.1"
    assert 'version = "0.1.1"' in new_text


def test_bump_patch_preserves_rest_of_file():
    text = '[project]\nname = "data-engine"\nversion = "1.2.9"\ndependencies = ["pandas"]\n'
    new_text, new_version = bump_patch(text)
    assert new_version == "1.2.10"
    assert 'dependencies = ["pandas"]' in new_text
    assert 'version = "1.2.9"' not in new_text


def test_bump_patch_only_touches_first_version():
    text = 'version = "0.1.0"\n# version = "9.9.9" noted here\n'
    new_text, new_version = bump_patch(text)
    assert new_version == "0.1.1"
    assert 'version = "9.9.9"' in new_text  # comment untouched
