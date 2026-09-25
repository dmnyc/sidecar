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
    '01-01': [
      { year: 1801, text: "Giuseppe Piazzi found Ceres from Palermo, the first asteroid anyone had seen." },
      { year: 1863, text: "The Emancipation Proclamation took effect, declaring enslaved people in the rebel states free." },
    ],
    '01-07': [
      { year: 1610, text: "Galileo turned a telescope on Jupiter and found it had moons of its own." },
      { year: 1927, text: "Telephone service opened between New York and London. Three minutes cost seventy-five dollars." }, // AT&T and the GPO, by radio
    ],
    '01-08': [
      { year: 1889, text: "Herman Hollerith patented a machine that tallied punched cards, built to count the census faster." }, // US 395,782
    ],
    '01-09': [
      { year: 1793, text: "Jean-Pierre Blanchard flew a balloon out of Philadelphia while George Washington watched." }, // first manned flight in North America
    ],
    '01-10': [
      { year: 1863, text: "The first underground railway opened in London, between Paddington and Farringdon." }, // Metropolitan Railway
      { year: 1776, text: "Common Sense went on sale in Philadelphia, signed only by \"an Englishman.\"" }, // Thomas Paine
    ],
    '01-11': [
      { year: 1922, text: "Leonard Thompson, fourteen and dying of diabetes, became the first person treated with insulin." }, // Toronto General Hospital
    ],
    '01-15': [
      { year: 1759, text: "The British Museum opened in Bloomsbury, free to \"all studious and curious persons.\"" }, // Montagu House
    ],
    '01-17': [
      { year: 1773, text: "HMS Resolution and Adventure crossed the Antarctic Circle, the first ships known to have done it." }, // Cook's second voyage
    ],
    '01-24': [
      { year: 1848, text: "James Marshall saw something shining in the tailrace at Sutter's Mill, and California changed." },
    ],
    '01-25': [
      { year: 1924, text: "The first Winter Olympics opened in Chamonix, under the shadow of Mont Blanc." },
    ],
    '01-26': [
      { year: 1926, text: "John Logie Baird showed moving pictures by wire to a roomful of scientists in Soho." }, // Royal Institution members, Frith Street
    ],
    '01-27': [
      { year: 1756, text: "Wolfgang Amadeus Mozart was born in Salzburg." },
    ],
    '01-28': [
      { year: 1813, text: "Pride and Prejudice was published, credited only to \"the author of Sense and Sensibility.\"" },
    ],
    '01-29': [
      { year: 1886, text: "Karl Benz patented a three-wheeled vehicle powered by a gas engine, the first true automobile." }, // DRP 37435
    ],
    '02-01': [
      { year: 1884, text: "The first part of the Oxford English Dictionary came out. It covered A to Ant." },
    ],
    '02-07': [
      { year: 1812, text: "Charles Dickens was born in Portsmouth, the son of a navy pay clerk." },
    ],
    '02-12': [
      { year: 1809, text: "Charles Darwin and Abraham Lincoln were born on the same day, an ocean apart." },
    ],
    '02-18': [
      { year: 1930, text: "Clyde Tombaugh, twenty-four, spotted Pluto by comparing two photographs of the same patch of sky." }, // Lowell Observatory
    ],
    '02-20': [
      { year: 1872, text: "The Metropolitan Museum of Art opened, in a former dancing academy on Fifth Avenue." }, // 681 Fifth Avenue
    ],
    '02-21': [
      { year: 1804, text: "Richard Trevithick ran the first steam locomotive, hauling iron and seventy men in Wales." }, // Penydarren tramroad
      { year: 1878, text: "New Haven printed the first telephone directory: one page, fifty names, and no numbers." },
    ],
    '02-22': [
      { year: 1879, text: "Frank Woolworth opened a store in Utica where everything cost five cents." }, // it failed within months; Lancaster worked
    ],
    '02-26': [
      { year: 1935, text: "Robert Watson-Watt bounced radio waves off a passing bomber near Daventry, and radar worked." },
    ],
    '02-29': [
      { year: 1504, text: "Stranded on Jamaica, Columbus used a predicted lunar eclipse to frighten the locals into feeding his crew." },
    ],
    '03-01': [
      { year: 1872, text: "Yellowstone became the first national park anywhere in the world." },
    ],
    '03-06': [
      { year: 1899, text: "Bayer registered the name Aspirin." },
    ],
    '03-10': [
      { year: 1876, text: "Alexander Graham Bell made the first telephone call, to his assistant in the next room." },
      { year: 1913, text: "Harriet Tubman died in Auburn, New York. She had never lost a passenger." },
    ],
    '03-13': [
      { year: 1781, text: "William Herschel found Uranus from his back garden in Bath, and thought at first it was a comet." },
    ],
    '03-14': [
      { year: 1879, text: "Albert Einstein was born in Ulm." },
    ],
    '03-16': [
      { year: 1926, text: "Robert Goddard launched the first liquid-fueled rocket from a farm in Auburn. It flew for two and a half seconds." },
    ],
    '03-20': [
      { year: 1852, text: "Uncle Tom's Cabin came out as a book and sold ten thousand copies in its first week." },
    ],
    '03-25': [
      { year: 1655, text: "Christiaan Huygens found Titan, the largest moon of Saturn." },
    ],
    '03-30': [
      { year: 1867, text: "The United States agreed to buy Alaska from Russia for $7.2 million, about two cents an acre." },
    ],
    '03-31': [
      { year: 1889, text: "The Eiffel Tower opened, built as a temporary exhibit and never taken down." },
      { year: 1918, text: "Americans set their clocks forward for the first time, to save fuel for the war." }, // Standard Time Act
    ],
    '04-03': [
      { year: 1860, text: "The first Pony Express rider left St. Joseph, Missouri, with mail for California." },
    ],
    '04-06': [
      { year: 1896, text: "The first modern Olympic Games opened in Athens." },
      { year: 1909, text: "Robert Peary said he had reached the North Pole. Whether he did is still argued." },
    ],
    '04-15': [
      { year: 1452, text: "Leonardo da Vinci was born near the Tuscan town of Vinci." },
      { year: 1912, text: "The Titanic sank in the North Atlantic, less than three hours after striking an iceberg." },
    ],
    '04-18': [
      { year: 1906, text: "An earthquake shook San Francisco before dawn, and the fires that followed burned for days." },
    ],
    '04-23': [
      { year: 1838, text: "The Great Western reached New York, and crossing the Atlantic stopped depending on the wind." }, // first scheduled transatlantic steamship
      { year: 1616, text: "William Shakespeare died in Stratford, on or near his fifty-second birthday." },
    ],
    '04-24': [
      { year: 1800, text: "Congress set aside five thousand dollars for books, and the Library of Congress began." },
    ],
    '04-29': [
      { year: 1770, text: "James Cook anchored in Botany Bay, the first European landing on Australia's east coast." }, // Endeavour voyage
      { year: 1852, text: "Peter Mark Roget published his Thesaurus, a book of words arranged by what they mean." },
    ],
    '04-30': [
      { year: 1789, text: "George Washington took the oath of office on a balcony on Wall Street." }, // Federal Hall
    ],
    '05-01': [
      { year: 1851, text: "The Great Exhibition opened in the Crystal Palace, in Hyde Park." },
      { year: 1931, text: "The Empire State Building opened, a little over a year after work began." },
    ],
    '05-06': [
      { year: 1840, text: "The Penny Black became valid, the first adhesive postage stamp." },
    ],
    '05-10': [
      { year: 1869, text: "A golden spike joined the rails at Promontory Summit, and America had a railway coast to coast." }, // transcontinental railroad
      { year: 1908, text: "Anna Jarvis held the first Mother's Day service, in a church in Grafton, West Virginia." },
    ],
    '05-14': [
      { year: 1804, text: "Lewis and Clark started up the Missouri, under orders to keep going until they reached the sea." }, // Corps of Discovery
      { year: 1796, text: "Edward Jenner scratched cowpox into the arm of an eight-year-old boy, and vaccination began." }, // James Phipps
    ],
    '05-17': [
      { year: 1875, text: "The first Kentucky Derby was run at Louisville, and won by a horse called Aristides." },
    ],
    '05-20': [
      { year: 1873, text: "Levi Strauss and Jacob Davis patented riveted work pants, and blue jeans were born." }, // US 139,121
    ],
    '05-21': [
      { year: 1932, text: "Amelia Earhart put down in a Derry field, the first woman to fly the Atlantic alone." }, // five years to the day after Lindbergh
      { year: 1927, text: "Charles Lindbergh landed outside Paris, alone, after thirty-three hours in the air." },
    ],
    '05-24': [
      { year: 1930, text: "Amy Johnson landed in Darwin, the first woman to fly alone from England to Australia." }, // 19 days, in a secondhand Gipsy Moth
      { year: 1844, text: "Samuel Morse sent \"What hath God wrought\" by telegraph from Washington to Baltimore." },
      { year: 1883, text: "The Brooklyn Bridge opened, the longest suspension bridge in the world." },
    ],
    '05-26': [
      { year: 1897, text: "Bram Stoker's Dracula was published in London." },
    ],
    '05-27': [
      { year: 1937, text: "The Golden Gate Bridge opened to pedestrians, a day before the cars." },
    ],
    '05-29': [
      { year: 1919, text: "Arthur Eddington photographed a solar eclipse and caught starlight bending, as Einstein had said it would." }, // Principe
    ],
    '06-04': [
      { year: 1783, text: "The Montgolfier brothers sent a paper balloon over a market square, with nobody aboard." }, // public demonstration at Annonay
      { year: 1896, text: "Henry Ford drove his first car out of a shed in Detroit, after knocking a hole in the wall to fit it through." }, // Quadricycle
    ],
    '06-14': [
      { year: 1777, text: "Congress adopted a flag of thirteen stripes and thirteen stars." },
    ],
    '06-15': [
      { year: 1919, text: "Alcock and Brown came down in an Irish bog, having crossed the Atlantic without stopping." }, // first nonstop transatlantic flight
      { year: 1215, text: "King John set his seal to Magna Carta in a meadow at Runnymede." },
    ],
    '06-19': [
      { year: 1865, text: "Union troops reached Galveston with word that the enslaved people of Texas were free." }, // Juneteenth
    ],
    '06-23': [
      { year: 1868, text: "Christopher Sholes patented a typewriter. The keyboard came later." },
    ],
    '06-26': [
      { year: 1945, text: "Fifty nations signed the United Nations Charter in San Francisco." },
    ],
    '06-28': [
      { year: 1919, text: "The Treaty of Versailles was signed in the Hall of Mirrors." },
    ],
    '06-30': [
      { year: 1908, text: "Something exploded over the Siberian forest at Tunguska and flattened eighty million trees." },
      { year: 1859, text: "Charles Blondin walked across Niagara Gorge on a tightrope." },
    ],
    '07-01': [
      { year: 1867, text: "Canada became a country, joining Ontario, Quebec, Nova Scotia and New Brunswick." },
    ],
    '07-02': [
      { year: 1900, text: "The first Zeppelin lifted off Lake Constance and stayed up for eighteen minutes." }, // LZ 1
      { year: 1776, text: "Congress voted for independence. John Adams expected July 2 to be the day Americans celebrated." },
    ],
    '07-04': [
      { year: 1776, text: "Congress adopted the Declaration of Independence in Philadelphia." },
      { year: 1865, text: "Alice's Adventures in Wonderland was published, three years to the day after the boat trip where it began." },
    ],
    '07-05': [
      { year: 1687, text: "Isaac Newton's Principia was published, with the laws of motion and gravity in it." },
    ],
    '07-06': [
      { year: 1885, text: "Louis Pasteur gave a boy bitten by a rabid dog the first rabies vaccine. The boy lived." }, // Joseph Meister
    ],
    '07-08': [
      { year: 1497, text: "Vasco da Gama sailed from Lisbon to look for a sea route to India, and found one." }, // returned 1499
      { year: 1889, text: "The first Wall Street Journal went on sale, four pages for two cents." },
    ],
    '07-11': [
      { year: 1405, text: "Zheng He's fleet left for the western oceans, hundreds of ships and tens of thousands of men." }, // first of seven voyages; China marks the date as Maritime Day
      { year: 1804, text: "Aaron Burr shot Alexander Hamilton in a duel at Weehawken." },
    ],
    '07-14': [
      { year: 1789, text: "A crowd stormed the Bastille in Paris. It held seven prisoners." },
    ],
    '07-22': [
      { year: 1933, text: "Wiley Post landed back in New York, the first person to fly around the world alone." }, // 7 days, 18 hours
      { year: 1587, text: "English colonists landed at Roanoke. Three years later nobody could find them." },
    ],
    '07-24': [
      { year: 1911, text: "Hiram Bingham was led up a mountain in Peru to the ruins of Machu Picchu." },
    ],
    '07-25': [
      { year: 1909, text: "Louis Bleriot crossed the English Channel by air in thirty-seven minutes." }, // Calais to Dover
      { year: 1814, text: "George Stephenson's first locomotive, Blucher, hauled thirty tons of coal up a hill." }, // Killingworth
    ],
    '08-06': [
      { year: 1926, text: "Gertrude Ederle swam the English Channel, two hours faster than any man had." },
    ],
    '08-10': [
      { year: 1846, text: "The Smithsonian Institution was founded with money left by a British scientist who never visited America." }, // James Smithson
    ],
    '08-12': [
      { year: 1851, text: "Isaac Singer patented a sewing machine that could be used at home." },
    ],
    '08-15': [
      { year: 1914, text: "The Panama Canal opened, and ships stopped going the long way round South America." }, // SS Ancon made the first passage
      { year: 1947, text: "India became independent at midnight." },
    ],
    '08-16': [
      { year: 1858, text: "The first message crossed the Atlantic by cable. It took sixteen hours to send." },
      { year: 1896, text: "Gold was found on Bonanza Creek in the Yukon, and the Klondike rush began." },
    ],
    '08-17': [
      { year: 1807, text: "Robert Fulton's steamboat left New York for Albany. People called it Fulton's Folly until it arrived." }, // the Clermont
    ],
    '08-21': [
      { year: 1911, text: "The Mona Lisa was stolen from the Louvre. It was gone for more than two years." },
    ],
    '08-26': [
      { year: 1920, text: "The Nineteenth Amendment took effect, and American women won the vote." },
    ],
    '08-27': [
      { year: 1859, text: "Edwin Drake struck oil at Titusville, Pennsylvania, sixty-nine feet down." },
      { year: 1883, text: "Krakatoa exploded. The sound was heard nearly three thousand miles away." },
    ],
    '09-02': [
      { year: 1666, text: "A fire started in a bakery on Pudding Lane and burned for four days across London." },
    ],
    '09-03': [
      { year: 1783, text: "The Treaty of Paris was signed, and Britain recognized the United States." },
    ],
    '09-04': [
      { year: 1882, text: "Pearl Street Station switched on in Manhattan, and electric light came to a square mile of the city." },
    ],
    '09-06': [
      { year: 1522, text: "The Victoria reached Spain with eighteen men aboard, the first ship to sail around the world." }, // Magellan and Elcano expedition
      { year: 1492, text: "Columbus left the Canary Islands and sailed west into open water." },
    ],
    '09-08': [
      { year: 1565, text: "Spanish settlers founded St. Augustine in Florida, now the oldest city in the United States." },
    ],
    '09-12': [
      { year: 1940, text: "Four teenagers followed a dog into a hole near Lascaux and found cave walls painted with animals." },
    ],
    '09-14': [
      { year: 1814, text: "Francis Scott Key saw the flag still over Fort McHenry at dawn and wrote a poem about it." },
    ],
    '09-15': [
      { year: 1835, text: "HMS Beagle reached the Galapagos, with a young naturalist aboard." },
    ],
    '09-16': [
      { year: 1620, text: "The Mayflower sailed from Plymouth, two months late and one ship short." }, // the Speedwell had turned back twice
      { year: 1908, text: "William Durant founded General Motors in Flint, Michigan." },
    ],
    '09-17': [
      { year: 1859, text: "Joshua Norton declared himself Emperor of the United States. San Francisco played along for twenty-one years." },
      { year: 1787, text: "The United States Constitution was signed in Philadelphia, by thirty-nine of the fifty-five delegates." },
    ],
    '09-19': [
      { year: 1893, text: "New Zealand gave women the vote, the first country in the world to do it." },
      { year: 1783, text: "A sheep, a duck and a rooster went up in a balloon at Versailles, and came down unhurt." },
    ],
    '09-20': [
      { year: 1519, text: "Magellan sailed west with five ships to look for a way through the Americas." }, // one ship finished the voyage
      { year: 1946, text: "The first Cannes Film Festival opened." },
    ],
    '09-23': [
      { year: 1846, text: "Astronomers in Berlin found Neptune within a degree of where the math said it would be." }, // Galle, from Le Verrier's prediction
    ],
    '09-24': [
      { year: 1852, text: "Henri Giffard steered a steam powered airship from Paris to Trappes, the first powered flight." }, // 27 km
      { year: 1906, text: "Devils Tower in Wyoming became the first national monument." },
    ],
    '09-27': [
      { year: 1825, text: "The Stockton and Darlington opened, the first public railway worked by steam." }, // Locomotion No. 1
      { year: 1908, text: "The first Model T rolled out of Ford's Piquette Avenue plant in Detroit." },
    ],
    '09-28': [
      { year: 1928, text: "Alexander Fleming came back to an untidy lab and noticed what the mould had done." },
      { year: 1066, text: "William of Normandy landed at Pevensey with an army and a claim to the English throne." },
    ],
    '10-01': [
      { year: 1890, text: "Congress made Yosemite a national park." },
    ],
    '10-08': [
      { year: 1871, text: "A fire started in a barn on DeKoven Street and burned the center of Chicago." },
    ],
    '10-14': [
      { year: 1947, text: "Chuck Yeager flew faster than sound over the Mojave, with two broken ribs he had not mentioned." }, // Bell X-1
      { year: 1926, text: "Winnie-the-Pooh was published in London." },
    ],
    '10-16': [
      { year: 1846, text: "A Boston surgeon removed a tumor from a patient put under with ether, and anesthesia went public." }, // Massachusetts General, "Ether Day"
    ],
    '10-22': [
      { year: 1797, text: "Andre-Jacques Garnerin jumped from a balloon over Paris with a silk parachute, the first to do it." }, // Parc Monceau
    ],
    '10-24': [
      { year: 1901, text: "Annie Edson Taylor went over Niagara Falls in a barrel on her sixty-third birthday, and lived." },
    ],
    '10-26': [
      { year: 1825, text: "The Erie Canal opened, joining the Great Lakes to the Atlantic by way of the Hudson." },
    ],
    '10-27': [
      { year: 1904, text: "The New York City subway opened, and carried over a hundred thousand people on its first evening." },
    ],
    '10-28': [
      { year: 1886, text: "The Statue of Liberty was dedicated in New York Harbor, a gift from the people of France." },
    ],
    '10-30': [
      { year: 1938, text: "Orson Welles broadcast The War of the Worlds as a series of news bulletins." },
    ],
    '11-02': [
      { year: 1920, text: "KDKA in Pittsburgh read out the presidential election returns, the first commercial radio broadcast." },
    ],
    '11-04': [
      { year: 1922, text: "Howard Carter found the step that led down to Tutankhamun's tomb." },
      { year: 1879, text: "James Ritty patented the cash register, to stop the staff in his saloon helping themselves." },
    ],
    '11-08': [
      { year: 1895, text: "Wilhelm Rontgen noticed a screen glowing across his darkened lab, and discovered X-rays." },
    ],
    '11-11': [
      { year: 1918, text: "The guns fell silent on the Western Front at eleven in the morning." },
    ],
    '11-17': [
      { year: 1869, text: "The Suez Canal opened, joining the Mediterranean to the Red Sea." },
      { year: 1558, text: "Elizabeth I came to the throne, and kept it for forty-four years." },
    ],
    '11-18': [
      { year: 1883, text: "American railroads switched to standard time zones. Until then every town kept its own." },
      { year: 1928, text: "Steamboat Willie opened in New York, the first Mickey Mouse cartoon with synchronized sound." },
    ],
    '11-19': [
      { year: 1863, text: "Lincoln spoke for about two minutes at Gettysburg." },
    ],
    '11-21': [
      { year: 1783, text: "Two men rose over Paris in a hot air balloon, the first people to leave the ground." },
      { year: 1877, text: "Thomas Edison announced a machine that could record sound and play it back." },
    ],
    '11-24': [
      { year: 1859, text: "On the Origin of Species was published. The first printing sold out to booksellers the same day." },
    ],
    '11-29': [
      { year: 1929, text: "Richard Byrd flew over the South Pole and turned straight round, having dumped food to gain height." }, // 19 hours
      { year: 1890, text: "Army and Navy played football for the first time. Navy won." }, // 24-0, at West Point
    ],
    '12-02': [
      { year: 1942, text: "Under a stadium in Chicago, Enrico Fermi's team started the first nuclear chain reaction." }, // Chicago Pile-1, Stagg Field
    ],
    '12-10': [
      { year: 1901, text: "The first Nobel Prizes were awarded, five years to the day after Alfred Nobel died." },
    ],
    '12-12': [
      { year: 1901, text: "Guglielmo Marconi heard three faint clicks in Newfoundland, sent by radio from Cornwall." }, // the letter S, Signal Hill
    ],
    '12-14': [
      { year: 1911, text: "Roald Amundsen reached the South Pole, five weeks ahead of Scott." },
      { year: 1900, text: "Max Planck told the German Physical Society that energy comes in small packets, and quantum theory began." },
    ],
    '12-16': [
      { year: 1773, text: "Colonists dumped 342 chests of tea into Boston Harbor." },
    ],
    '12-17': [
      { year: 1903, text: "The Wright brothers flew at Kitty Hawk. The longest of the four flights lasted 59 seconds." },
      { year: 1790, text: "The Aztec sun stone was dug up under the main square of Mexico City." },
    ],
    '12-21': [
      { year: 1913, text: "The New York World printed the first crossword puzzle. It was shaped like a diamond." }, // Arthur Wynne, "word-cross"
    ],
    '12-23': [
      { year: 1947, text: "Bell Labs showed off the transistor to its own executives, and kept quiet about it for six months." },
    ],
    '12-24': [
      { year: 1818, text: "Silent Night was sung for the first time, in a church in Oberndorf, to a guitar." },
    ],
};
