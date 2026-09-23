// On this day. HAND-WRITTEN, and meant to be added to.
//
// Keyed MM-DD, an array per day, newest file in the repo you are likely to want to
// edit. A day with no entry shows NO CARD in the panel, so partial coverage is the
// designed state rather than a gap to apologize for: write the days you care about and
// leave the rest silent.
//
// TO ADD ONE
//
//   '07-20': [
//     { year: 1837, text: 'Euston opened, the first railway terminus in London.' },
//   ],
//
// The rules, all enforced by test/on-this-day.test.js so a mistake fails the suite
// rather than shipping:
//
//   - key is MM-DD, zero padded, and has to be a day that exists
//   - `year` at least 75 years ago, counted from the current year, not a fixed date
//   - `text` is one or two sentences, 140 characters maximum, no em dash
//   - US English, and the panel is 360px wide, so short beats complete
//
// Several entries on one date is the point rather than a bonus: the panel indexes by
// year, so a date carrying three lines goes three years before it repeats. Put the
// strongest first, since a date with one entry shows that one every year.
//
// Cite where you checked it in a trailing comment. Somebody will eventually ask whether
// a date is right, and "I believe so" is not an answer. A quote site is not a source.
//
// WHY THIS IS NOT GENERATED, and please do not try again. Wikidata is CC0 and its event
// classes are overwhelmingly military: eleven of twelve results for one sample date were
// battles. The Library of Congress's Today in History is CC0 and well chosen, but it
// gives subject titles rather than facts, pairs its year list with the wrong subject,
// 404s on some days, and rate-limits a bulk read to a stop. Both are excellent places to
// LOOK SOMETHING UP while writing a line. Neither is something to import.

window.SIDECAR_ON_THIS_DAY = {
    '01-07': [
      { year: 1610, text: "Galileo turned a telescope on Jupiter and found it had moons of its own." },
    ],
    '01-10': [
      { year: 1863, text: "The first underground railway opened in London, between Paddington and Farringdon." }, // Metropolitan Railway
    ],
    '02-21': [
      { year: 1804, text: "Richard Trevithick ran the first steam locomotive, hauling iron and seventy men in Wales." }, // Penydarren tramroad
    ],
    '03-10': [
      { year: 1876, text: "Alexander Graham Bell made the first telephone call, to his assistant in the next room." },
    ],
    '03-31': [
      { year: 1889, text: "The Eiffel Tower opened, built as a temporary exhibit and never taken down." },
    ],
    '04-06': [
      { year: 1896, text: "The first modern Olympic Games opened in Athens." },
    ],
    '04-23': [
      { year: 1838, text: "The Great Western reached New York, and crossing the Atlantic stopped depending on the wind." }, // first scheduled transatlantic steamship
    ],
    '04-29': [
      { year: 1770, text: "James Cook anchored in Botany Bay, the first European landing on Australia's east coast." }, // Endeavour voyage
    ],
    '05-01': [
      { year: 1851, text: "The Great Exhibition opened in the Crystal Palace, in Hyde Park." },
    ],
    '05-10': [
      { year: 1869, text: "A golden spike joined the rails at Promontory Summit, and America had a railway coast to coast." }, // transcontinental railroad
    ],
    '05-14': [
      { year: 1804, text: "Lewis and Clark started up the Missouri, under orders to keep going until they reached the sea." }, // Corps of Discovery
    ],
    '05-21': [
      { year: 1932, text: "Amelia Earhart put down in a Derry field, the first woman to fly the Atlantic alone." }, // five years to the day after Lindbergh
      { year: 1927, text: "Charles Lindbergh landed outside Paris, alone, after thirty-three hours in the air." },
    ],
    '05-24': [
      { year: 1930, text: "Amy Johnson landed in Darwin, the first woman to fly alone from England to Australia." }, // 19 days, in a secondhand Gipsy Moth
    ],
    '06-04': [
      { year: 1783, text: "The Montgolfier brothers sent a paper balloon over a market square, with nobody aboard." }, // public demonstration at Annonay
    ],
    '06-15': [
      { year: 1919, text: "Alcock and Brown came down in an Irish bog, having crossed the Atlantic without stopping." }, // first nonstop transatlantic flight
    ],
    '07-02': [
      { year: 1900, text: "The first Zeppelin lifted off Lake Constance and stayed up for eighteen minutes." }, // LZ 1
    ],
    '07-08': [
      { year: 1497, text: "Vasco da Gama sailed from Lisbon to look for a sea route to India, and found one." }, // returned 1499
    ],
    '07-11': [
      { year: 1405, text: "Zheng He's fleet left for the western oceans, hundreds of ships and tens of thousands of men." }, // first of seven voyages; China marks the date as Maritime Day
    ],
    '07-22': [
      { year: 1933, text: "Wiley Post landed back in New York, the first person to fly around the world alone." }, // 7 days, 18 hours
    ],
    '07-25': [
      { year: 1909, text: "Louis Bleriot crossed the English Channel by air in thirty-seven minutes." }, // Calais to Dover
    ],
    '08-15': [
      { year: 1914, text: "The Panama Canal opened, and ships stopped going the long way round South America." }, // SS Ancon made the first passage
    ],
    '08-16': [
      { year: 1858, text: "The first message crossed the Atlantic by cable. It took sixteen hours to send." },
    ],
    '09-06': [
      { year: 1522, text: "The Victoria reached Spain with eighteen men aboard, the first ship to sail around the world." }, // Magellan and Elcano expedition
    ],
    '09-16': [
      { year: 1620, text: "The Mayflower sailed from Plymouth, two months late and one ship short." }, // the Speedwell had turned back twice
    ],
    '09-17': [
      { year: 1859, text: "Joshua Norton declared himself Emperor of the United States. San Francisco played along for twenty-one years." },
      { year: 1787, text: "The United States Constitution was signed in Philadelphia, by thirty-nine of the fifty-five delegates." },
    ],
    '09-19': [
      { year: 1893, text: "New Zealand gave women the vote, the first country in the world to do it." },
    ],
    '09-20': [
      { year: 1519, text: "Magellan sailed west with five ships to look for a way through the Americas." }, // one ship finished the voyage
    ],
    '09-24': [
      { year: 1852, text: "Henri Giffard steered a steam powered airship from Paris to Trappes, the first powered flight." }, // 27 km
    ],
    '09-27': [
      { year: 1825, text: "The Stockton and Darlington opened, the first public railway worked by steam." }, // Locomotion No. 1
    ],
    '09-28': [
      { year: 1928, text: "Alexander Fleming came back to an untidy lab and noticed what the mould had done." },
    ],
    '10-14': [
      { year: 1947, text: "Chuck Yeager flew faster than sound over the Mojave, with two broken ribs he had not mentioned." }, // Bell X-1
    ],
    '11-04': [
      { year: 1922, text: "Howard Carter found the step that led down to Tutankhamun's tomb." },
    ],
    '11-17': [
      { year: 1869, text: "The Suez Canal opened, joining the Mediterranean to the Red Sea." },
      { year: 1558, text: "Elizabeth I came to the throne, and kept it for forty-four years." },
    ],
    '11-21': [
      { year: 1783, text: "Two men rose over Paris in a hot air balloon, the first people to leave the ground." },
    ],
    '11-29': [
      { year: 1929, text: "Richard Byrd flew over the South Pole and turned straight round, having dumped food to gain height." }, // 19 hours
    ],
    '12-14': [
      { year: 1911, text: "Roald Amundsen reached the South Pole, five weeks ahead of Scott." },
    ],
    '12-17': [
      { year: 1903, text: "The Wright brothers flew at Kitty Hawk. The longest of the four flights lasted 59 seconds." },
      { year: 1790, text: "The Aztec sun stone was dug up under the main square of Mexico City." },
    ],
};
