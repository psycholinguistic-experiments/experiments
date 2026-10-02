/* LT5461 — bird task: the materials of the Google Forms version ("Prototype
   theory test"): the same 12 pictures, names and 1–5 scale. The form showed
   them in a new random order for each person, and so does this task.
   key: the column name (as janitor::clean_names makes it in Bird plot.Rmd).
   name: the question title in the form. img: files in assets/img/birds/,
   <img>-<width>.avif|webp|jpg, one per listed width; w × h: the largest. */
window.BIRD_ITEMS = {
  scale: {
    n: 5,
    lo: 'Not at all typical: This doesn’t really fit my idea of a bird.',
    hi: 'Extremely typical: This is exactly what I imagine when I think of a bird.'
  },
  birds: [
    { key: 'house_sparrow', name: 'House Sparrow', img: 'house-sparrow', widths: [480, 960, 1024], w: 1024, h: 682 },
    { key: 'european_robin', name: 'European Robin', img: 'european-robin', widths: [480, 960, 1440], w: 1440, h: 960 },
    { key: 'blackbird', name: 'Blackbird', img: 'blackbird', widths: [480, 960, 1440], w: 1440, h: 964 },
    { key: 'blue_tit', name: 'Blue Tit', img: 'blue-tit', widths: [480, 960, 1440], w: 1440, h: 1080 },
    { key: 'swan', name: 'Swan', img: 'swan', widths: [480, 960, 1280], w: 1280, h: 852 },
    { key: 'penguin', name: 'Penguin', img: 'penguin', widths: [480, 554], w: 554, h: 598 },
    { key: 'ostrich', name: 'Ostrich', img: 'ostrich', widths: [480, 960, 1440], w: 1440, h: 1086 },
    { key: 'peacock', name: 'Peacock', img: 'peacock', widths: [480, 640], w: 640, h: 480 },
    { key: 'flamingo', name: 'Flamingo', img: 'flamingo', widths: [480, 960], w: 960, h: 1440 },
    { key: 'kiwi', name: 'Kiwi', img: 'kiwi', widths: [480, 960, 1440], w: 1440, h: 1080 },
    { key: 'emu', name: 'Emu', img: 'emu', widths: [480, 960, 1440], w: 1440, h: 1152 },
    { key: 'flying_fox', name: 'Flying fox', img: 'flying-fox', widths: [480, 800], w: 800, h: 618 }
  ]
};
