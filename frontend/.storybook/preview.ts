import type { Preview } from "@storybook/vue3-vite";

import "../src/style.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        mobile: {
          name: "Mobile 390 x 844",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
        tablet: {
          name: "Tablet 768 x 1024",
          styles: { width: "768px", height: "1024px" },
          type: "tablet",
        },
        desktop: {
          name: "Desktop 1440 x 900",
          styles: { width: "1440px", height: "900px" },
          type: "desktop",
        },
      },
    },
  },
};

export default preview;
