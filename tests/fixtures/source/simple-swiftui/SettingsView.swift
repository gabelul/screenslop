import SwiftUI

struct SettingsView: View {
    var body: some View {
        VStack {
            Button(action: save) {
                Image(systemName: "tray.and.arrow.down")
            }
            .accessibilityIdentifier("settings.saveButton")

            Button("Button", action: addGift)
                .accessibilityIdentifier("settings.genericButton")
                .accessibilityLabel("Button")

            Button(action: deleteGift) {
                Image(systemName: "trash")
            }
            .accessibilityIdentifier("settings.smallButton")
        }
    }

    func save() {}
    func addGift() {}
    func deleteGift() {}
}
