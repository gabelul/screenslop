import XCTest

final class RuntimeSmokeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testAppLaunchesRuntimeSmokeScreen() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["RuntimeSmoke"].waitForExistence(timeout: 5))
    }
}
