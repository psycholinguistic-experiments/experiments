/* LT5461 — animal task: the twenty mammals (the instructor's list), shared by
   the task page and the results page. The order is fixed: the data store
   inferences by these indices, so never reorder or remove; only append.
   [key, name on screen, plural used in the inference questions] */
window.ANIMAL_ITEMS = [
  ['cat', 'Cat', 'cats'], ['dog', 'Dog', 'dogs'], ['elephant', 'Elephant', 'elephants'], ['mouse', 'Mouse', 'mice'],
  ['horse', 'Horse', 'horses'], ['tiger', 'Tiger', 'tigers'], ['lion', 'Lion', 'lions'], ['zebra', 'Zebra', 'zebras'],
  ['cow', 'Cow', 'cows'], ['sheep', 'Sheep', 'sheep'], ['pig', 'Pig', 'pigs'], ['goat', 'Goat', 'goats'],
  ['bear', 'Bear', 'bears'], ['deer', 'Deer', 'deer'], ['giraffe', 'Giraffe', 'giraffes'], ['rhino', 'Rhino', 'rhinos'],
  ['rabbit', 'Rabbit', 'rabbits'], ['wolf', 'Wolf', 'wolves'], ['fox', 'Fox', 'foxes'], ['monkey', 'Monkey', 'monkeys']
].map(([key, name, plural]) => ({ key, name, plural }));
