import SwiftUI

struct FigIcon: View {
    let name: String
    var size: CGFloat = 24

    var body: some View {
        Image(name)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
