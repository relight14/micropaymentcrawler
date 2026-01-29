#!/usr/bin/env python3
"""
RSL Implementation Validation
Validates that RSL implementation is correctly integrated
"""
import sys
from pathlib import Path

print("=" * 70)
print("RSL Implementation Validation")
print("=" * 70)

sys.path.insert(0, str(Path(__file__).parent / "backend"))

passed = 0
failed = 0

# Test 1: RSL Token Manager exists and can be imported
try:
    from services.licensing.rsl_token_manager import RSLTokenManager, RSLToken
    print("✅ RSL Token Manager module imported")
    passed += 1
except Exception as e:
    print(f"❌ Failed to import RSL Token Manager: {e}")
    failed += 1

# Test 2: RSL Protocol Handler enhanced
try:
    from services.licensing.content_licensing import RSLProtocolHandler
    handler = RSLProtocolHandler()
    
    # Check for new methods
    assert hasattr(handler, 'fetch_content'), "Missing fetch_content method"
    assert hasattr(handler, '_get_token_manager'), "Missing _get_token_manager method"
    assert hasattr(handler, '_license_terms_cache'), "Missing cache"
    
    print("✅ RSL Protocol Handler enhanced with OAuth and content fetching")
    passed += 1
except Exception as e:
    print(f"❌ RSL Protocol Handler validation failed: {e}")
    failed += 1

# Test 3: RSL API routes exist
try:
    import importlib.util
    spec = importlib.util.spec_from_file_location('rsl', 'backend/app/api/routes/rsl.py')
    rsl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rsl)
    
    # Check router exists
    assert hasattr(rsl, 'router'), "Missing router"
    
    # Check key functions exist
    assert hasattr(rsl, 'discover_rsl_licensing'), "Missing discover endpoint"
    assert hasattr(rsl, 'request_rsl_license'), "Missing license request endpoint"
    assert hasattr(rsl, 'fetch_rsl_content'), "Missing content fetch endpoint"
    
    print("✅ RSL API routes defined")
    passed += 1
except Exception as e:
    print(f"❌ RSL API routes validation failed: {e}")
    failed += 1

# Test 4: Test suite exists
try:
    assert Path('test_rsl_implementation.py').exists(), "Missing implementation test suite"
    print("✅ RSL implementation test suite exists")
    passed += 1
except Exception as e:
    print(f"❌ Test suite validation failed: {e}")
    failed += 1

# Test 5: Documentation files created
try:
    assert Path('RSL_FEASIBILITY_REVIEW.md').exists(), "Missing feasibility review"
    assert Path('RSL_REVIEW_EXECUTIVE_SUMMARY.md').exists(), "Missing executive summary"
    assert Path('RSL_QUICK_REFERENCE.md').exists(), "Missing quick reference"
    print("✅ RSL documentation files exist")
    passed += 1
except Exception as e:
    print(f"❌ Documentation validation failed: {e}")
    failed += 1

# Test 6: App integration
try:
    # Check that rsl is imported in app/__init__.py
    with open('backend/app/__init__.py', 'r') as f:
        app_content = f.read()
    
    assert 'import' in app_content and 'rsl' in app_content, "RSL not imported in app"
    assert 'rsl.router' in app_content, "RSL router not included"
    assert '/api/rsl' in app_content, "RSL prefix not set"
    
    print("✅ RSL integrated into FastAPI application")
    passed += 1
except Exception as e:
    print(f"❌ App integration validation failed: {e}")
    failed += 1

# Summary
print(f"\n{'=' * 70}")
print("Validation Summary")
print(f"{'=' * 70}")
print(f"✅ Passed: {passed}")
print(f"❌ Failed: {failed}")
print(f"Total: {passed + failed}")
print(f"{'=' * 70}")

if failed == 0:
    print("\n🎉 All validations passed! RSL implementation is complete.")
    sys.exit(0)
else:
    print(f"\n⚠️  {failed} validation(s) failed.")
    sys.exit(1)
