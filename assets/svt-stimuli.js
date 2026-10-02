/* LT5461 — sentence verification task: the stimuli.

   Scored trials: 56 true targets + 56 false fillers, seven familiar categories.
   Targets: 4 high- and 4 low-typicality members per category. Fillers: 8 per
   category label, never given a typicality level and never analysed as one.
   Every noun appears once. Each category has one sentence frame, used for its
   targets and its fillers alike. Clothing uses the plural frame ("Socks are
   clothing.") because four of its members only exist in the plural.

   Each item: id, noun, sentence, correctAnswer ('true' | 'false'),
   trialType ('target' | 'filler'), semanticCategory, typicality ('high' |
   'low' | null), practice (true | false). */
(function () {
  'use strict';

  // [noun, sentence] per category: high- and low-typicality targets, then fillers.
  const SET = {
    animal: {
      high: [['dog', 'A dog is an animal.'], ['cat', 'A cat is an animal.'], ['horse', 'A horse is an animal.'], ['cow', 'A cow is an animal.']],
      low: [['snake', 'A snake is an animal.'], ['frog', 'A frog is an animal.'], ['turtle', 'A turtle is an animal.'], ['whale', 'A whale is an animal.']],
      filler: [['toaster', 'A toaster is an animal.'], ['pencil', 'A pencil is an animal.'], ['kettle', 'A kettle is an animal.'], ['pillow', 'A pillow is an animal.'],
        ['newspaper', 'A newspaper is an animal.'], ['suitcase', 'A suitcase is an animal.'], ['candle', 'A candle is an animal.'], ['camera', 'A camera is an animal.']]
    },
    bird: {
      high: [['sparrow', 'A sparrow is a bird.'], ['pigeon', 'A pigeon is a bird.'], ['eagle', 'An eagle is a bird.'], ['crow', 'A crow is a bird.']],
      low: [['penguin', 'A penguin is a bird.'], ['ostrich', 'An ostrich is a bird.'], ['peacock', 'A peacock is a bird.'], ['turkey', 'A turkey is a bird.']],
      filler: [['bee', 'A bee is a bird.'], ['squirrel', 'A squirrel is a bird.'], ['dragonfly', 'A dragonfly is a bird.'], ['lizard', 'A lizard is a bird.'],
        ['rabbit', 'A rabbit is a bird.'], ['dolphin', 'A dolphin is a bird.'], ['sheep', 'A sheep is a bird.'], ['mouse', 'A mouse is a bird.']]
    },
    vehicle: {
      high: [['car', 'A car is a vehicle.'], ['bus', 'A bus is a vehicle.'], ['truck', 'A truck is a vehicle.'], ['bicycle', 'A bicycle is a vehicle.']],
      low: [['tractor', 'A tractor is a vehicle.'], ['ambulance', 'An ambulance is a vehicle.'], ['helicopter', 'A helicopter is a vehicle.'], ['ferry', 'A ferry is a vehicle.']],
      filler: [['bridge', 'A bridge is a vehicle.'], ['traffic light', 'A traffic light is a vehicle.'], ['garage', 'A garage is a vehicle.'], ['road', 'A road is a vehicle.'],
        ['station', 'A station is a vehicle.'], ['ticket', 'A ticket is a vehicle.'], ['helmet', 'A helmet is a vehicle.'], ['engine', 'An engine is a vehicle.']]
    },
    furniture: {
      high: [['chair', 'A chair is furniture.'], ['table', 'A table is furniture.'], ['sofa', 'A sofa is furniture.'], ['bed', 'A bed is furniture.']],
      low: [['stool', 'A stool is furniture.'], ['bench', 'A bench is furniture.'], ['bookcase', 'A bookcase is furniture.'], ['wardrobe', 'A wardrobe is furniture.']],
      filler: [['plate', 'A plate is furniture.'], ['spoon', 'A spoon is furniture.'], ['bottle', 'A bottle is furniture.'], ['shoe', 'A shoe is furniture.'],
        ['phone', 'A phone is furniture.'], ['umbrella', 'An umbrella is furniture.'], ['toothbrush', 'A toothbrush is furniture.'], ['backpack', 'A backpack is furniture.']]
    },
    clothing: {
      high: [['shirt', 'Shirts are clothing.'], ['trousers', 'Trousers are clothing.'], ['dress', 'Dresses are clothing.'], ['jacket', 'Jackets are clothing.']],
      low: [['scarf', 'Scarves are clothing.'], ['socks', 'Socks are clothing.'], ['gloves', 'Gloves are clothing.'], ['pyjamas', 'Pyjamas are clothing.']],
      filler: [['towel', 'Towels are clothing.'], ['bedsheet', 'Bedsheets are clothing.'], ['wallet', 'Wallets are clothing.'], ['watch', 'Watches are clothing.'],
        ['ring', 'Rings are clothing.'], ['glasses', 'Glasses are clothing.'], ['key', 'Keys are clothing.'], ['notebook', 'Notebooks are clothing.']]
    },
    sport: {
      high: [['football', 'Football is a sport.'], ['basketball', 'Basketball is a sport.'], ['tennis', 'Tennis is a sport.'], ['swimming', 'Swimming is a sport.']],
      low: [['golf', 'Golf is a sport.'], ['judo', 'Judo is a sport.'], ['rowing', 'Rowing is a sport.'], ['skiing', 'Skiing is a sport.']],
      filler: [['cooking', 'Cooking is a sport.'], ['reading', 'Reading is a sport.'], ['sleeping', 'Sleeping is a sport.'], ['shopping', 'Shopping is a sport.'],
        ['painting', 'Painting is a sport.'], ['singing', 'Singing is a sport.'], ['typing', 'Typing is a sport.'], ['studying', 'Studying is a sport.']]
    },
    instrument: {
      high: [['piano', 'A piano is a musical instrument.'], ['guitar', 'A guitar is a musical instrument.'], ['violin', 'A violin is a musical instrument.'], ['drum', 'A drum is a musical instrument.']],
      low: [['flute', 'A flute is a musical instrument.'], ['cello', 'A cello is a musical instrument.'], ['harp', 'A harp is a musical instrument.'], ['trumpet', 'A trumpet is a musical instrument.']],
      filler: [['microphone', 'A microphone is a musical instrument.'], ['speaker', 'A speaker is a musical instrument.'], ['radio', 'A radio is a musical instrument.'], ['headphones', 'Headphones are a musical instrument.'],
        ['music stand', 'A music stand is a musical instrument.'], ['amplifier', 'An amplifier is a musical instrument.'], ['record', 'A record is a musical instrument.'], ['concert', 'A concert is a musical instrument.']]
    }
  };

  const PRACTICE = [
    ['P1', 'mango', 'A mango is a fruit.', 'true', 'fruit'],
    ['P2', 'brick', 'A brick is a fruit.', 'false', 'fruit'],
    ['P3', 'salmon', 'A salmon is a fish.', 'true', 'fish'],
    ['P4', 'coin', 'A coin is a fish.', 'false', 'fish'],
    ['P5', 'rose', 'A rose is a flower.', 'true', 'flower'],
    ['P6', 'mug', 'A mug is a flower.', 'false', 'flower'],
    ['P7', 'hand', 'A hand is a body part.', 'true', 'body part'],
    ['P8', 'window', 'A window is a body part.', 'false', 'body part']
  ];

  const slug = s => s.replace(/\s+/g, '-');
  const scored = [];
  Object.keys(SET).forEach(cat => {
    ['high', 'low'].forEach(typ => SET[cat][typ].forEach(([noun, sentence]) => scored.push({
      id: 'T-' + slug(noun), noun, sentence, correctAnswer: 'true',
      trialType: 'target', semanticCategory: cat, typicality: typ, practice: false
    })));
    SET[cat].filler.forEach(([noun, sentence]) => scored.push({
      id: 'F-' + slug(noun), noun, sentence, correctAnswer: 'false',
      trialType: 'filler', semanticCategory: cat, typicality: null, practice: false
    }));
  });

  window.SVT_STIMULI = {
    version: 'svt-2026-1',
    scored,
    practice: PRACTICE.map(([id, noun, sentence, correctAnswer, cat]) => ({
      id, noun, sentence, correctAnswer, trialType: correctAnswer === 'true' ? 'target' : 'filler',
      semanticCategory: cat, typicality: null, practice: true
    }))
  };
})();
