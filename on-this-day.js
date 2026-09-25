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
    { year: 1925, text: "Edwin Hubble announced the discovery of galaxies outside the Milky Way, proving the universe was far larger than we knew." }, // American Astronomical Society
  ],
  '01-02': [
    { year: 1900, text: "John Hay announced the Open Door Policy to promote equal trade access in China." }, // US diplomatic note
  ],
  '01-03': [
    { year: 1925, text: "Benito Mussolini dissolved the Italian parliament and declared himself dictator." }, // speech to Chamber of Deputies
  ],
  '01-04': [
    { year: 1847, text: "Samuel Colt sold his first revolver pistols to the United States government." }, // Walker Colt contract
  ],
  '01-05': [
    { year: 1914, text: "Henry Ford introduced a five dollar daily wage for an eight hour day." }, // Ford Motor Company
  ],
  '01-06': [
    { year: 1838, text: "Samuel Morse gave the first public demonstration of the telegraph in New Jersey." }, // Speedwell Ironworks
  ],
  '01-07': [
    { year: 1610, text: "Galileo turned a telescope on Jupiter and found it had moons of its own." },
    { year: 1927, text: "Telephone service opened between New York and London. Three minutes cost seventy-five dollars." }, // AT&T and the GPO, by radio
  ],
  '01-08': [
    { year: 1889, text: "Herman Hollerith patented a machine that tallied punched cards, built to count the census faster." }, // US 395,782
    { year: 1918, text: "Woodrow Wilson outlined his Fourteen Points for peace in a speech to Congress." }, // World War I aims
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
  '01-12': [
    { year: 1932, text: "Hattie Caraway became the first woman elected to the United States Senate." }, // Arkansas special election
  ],
  '01-13': [
    { year: 1910, text: "Lee de Forest broadcast a live performance of Enrico Caruso from the Metropolitan Opera." }, // radio broadcast
  ],
  '01-14': [
    { year: 1943, text: "Franklin Roosevelt and Winston Churchill met in secret at Casablanca to plan the Allied strategy." }, // Casablanca Conference
  ],
  '01-15': [
    { year: 1759, text: "The British Museum opened in Bloomsbury, free to \"all studious and curious persons.\"" }, // Montagu House
  ],
  '01-16': [
    { year: 1919, text: "Nebraska ratified the Eighteenth Amendment, ensuring prohibition would become the law." }, // US Constitution
  ],
  '01-17': [
    { year: 1773, text: "HMS Resolution and Adventure crossed the Antarctic Circle, the first ships known to have done it." }, // Cook's second voyage
  ],
  '01-18': [
    { year: 1911, text: "Eugene Ely landed a biplane on the deck of the USS Pennsylvania anchored in San Francisco Bay." }, // first shipboard landing
  ],
  '01-19': [
    { year: 1915, text: "George Claude patented the neon discharge tube for use in advertising signs." }, // US 1,125,476
  ],
  '01-20': [
    { year: 1937, text: "Franklin Roosevelt became the first president inaugurated on January 20 instead of March 4." }, // Twentieth Amendment
  ],
  '01-21': [
    { year: 1793, text: "King Louis XVI of France was executed by guillotine in Paris." }, // Place de la Revolution
  ],
  '01-22': [
    { year: 1901, text: "Queen Victoria died on the Isle of Wight after a reign of nearly sixty-four years." }, // Osborne House
  ],
  '01-23': [
    { year: 1849, text: "Elizabeth Blackwell received her medical degree, the first woman to do so in the United States." }, // Geneva Medical College
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
  '01-30': [
    { year: 1948, text: "Mahatma Gandhi was assassinated in New Delhi while walking to a prayer meeting." }, // Birla House
  ],
  '01-31': [
    { year: 1929, text: "Leon Trotsky was expelled from the Soviet Union and deported to Turkey." }, // Soviet exile
  ],
  '02-01': [
    { year: 1884, text: "The first part of the Oxford English Dictionary came out. It covered A to Ant." },
    { year: 1893, text: "Thomas Edison finished the Black Maria in New Jersey, creating the first motion picture studio." }, // West Orange
  ],
  '02-02': [
    { year: 1848, text: "The Treaty of Guadalupe Hidalgo was signed, ending the Mexican-American War." }, // Mexico City
  ],
  '02-03': [
    { year: 1913, text: "The Sixteenth Amendment was ratified, allowing Congress to levy a nationwide income tax." }, // US Constitution
  ],
  '02-04': [
    { year: 1945, text: "Roosevelt, Churchill, and Stalin met at Yalta to discuss the postwar reorganization of Europe." }, // Yalta Conference
  ],
  '02-05': [
    { year: 1919, text: "Charlie Chaplin, Mary Pickford, Douglas Fairbanks, and D.W. Griffith launched United Artists." }, // independent studio
  ],
  '02-06': [
    { year: 1840, text: "The Treaty of Waitangi was signed, establishing a British governor in New Zealand." }, // Bay of Islands
  ],
  '02-07': [
    { year: 1812, text: "Charles Dickens was born in Portsmouth, the son of a navy pay clerk." },
  ],
  '02-08': [
    { year: 1910, text: "The Boy Scouts of America was incorporated by William D. Boyce." }, // Washington D.C.
  ],
  '02-09': [
    { year: 1895, text: "William G. Morgan invented Mintonette in Massachusetts, a game now known as volleyball." }, // Holyoke YMCA
  ],
  '02-10': [
    { year: 1840, text: "Queen Victoria married Prince Albert of Saxe-Coburg and Gotha at St. James's Palace." }, // London
  ],
  '02-11': [
    { year: 1937, text: "General Motors recognized the United Auto Workers, ending the Flint sit-down strike." }, // Michigan
  ],
  '02-12': [
    { year: 1809, text: "Charles Darwin and Abraham Lincoln were born on the same day, an ocean apart." },
  ],
  '02-13': [
    { year: 1920, text: "Rube Foster founded the Negro National League in a YMCA in Kansas City." }, // baseball
  ],
  '02-14': [
    { year: 1876, text: "Alexander Graham Bell applied for a patent for the telephone, just hours before Elisha Gray." }, // US Patent 174,465
  ],
  '02-15': [
    { year: 1898, text: "The USS Maine exploded and sank in Havana Harbor, killing over two hundred sailors." }, // Spanish-American War
  ],
  '02-16': [
    { year: 1923, text: "Howard Carter unsealed the burial chamber of Pharaoh Tutankhamun." }, // Valley of the Kings
  ],
  '02-17': [
    { year: 1864, text: "The H.L. Hunley sank the USS Housatonic, becoming the first combat submarine to sink a warship." }, // Charleston Harbor
  ],
  '02-18': [
    { year: 1930, text: "Clyde Tombaugh, twenty-four, spotted Pluto by comparing two photographs of the same patch of sky." }, // Lowell Observatory
  ],
  '02-19': [
    { year: 1945, text: "US Marines landed on Iwo Jima, beginning a grueling five-week battle." }, // Volcano Islands
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
  '02-23': [
    { year: 1945, text: "Joe Rosenthal photographed Marines raising the flag on Mount Suribachi." }, // Iwo Jima
  ],
  '02-24': [
    { year: 1868, text: "The House of Representatives voted to impeach President Andrew Johnson." }, // first presidential impeachment
  ],
  '02-25': [
    { year: 1901, text: "J.P. Morgan incorporated United States Steel, the first billion dollar corporation." }, // New Jersey
  ],
  '02-26': [
    { year: 1935, text: "Robert Watson-Watt bounced radio waves off a passing bomber near Daventry, and radar worked." },
  ],
  '02-27': [
    { year: 1933, text: "The Reichstag building in Berlin caught fire, an event seized upon by the Nazi Party." }, // arson
    { year: 1940, text: "Martin Kamen and Sam Ruben discovered carbon-14, giving scientists a way to date ancient artifacts." }, // UC Berkeley
  ],
  '02-28': [
    { year: 1935, text: "Wallace Carothers synthesized nylon for the first time in a DuPont laboratory." }, // Delaware
  ],
  '02-29': [
    { year: 1504, text: "Stranded on Jamaica, Columbus used a predicted lunar eclipse to frighten the locals into feeding his crew." },
  ],
  '03-01': [
    { year: 1872, text: "Yellowstone became the first national park anywhere in the world." },
  ],
  '03-02': [
    { year: 1933, text: "King Kong premiered at Radio City Music Hall in New York, breaking attendance records." }, // RKO Pictures
  ],
  '03-03': [
    { year: 1931, text: "President Herbert Hoover signed a law making The Star-Spangled Banner the national anthem." }, // US Congress
  ],
  '03-04': [
    { year: 1789, text: "The United States Constitution went into effect as the first Congress met in New York." }, // Federal Hall
  ],
  '03-05': [
    { year: 1770, text: "British soldiers fired into a crowd in Boston, killing five men in what became the Boston Massacre." },
  ],
  '03-06': [
    { year: 1899, text: "Bayer registered the name Aspirin." },
  ],
  '03-07': [
    { year: 1876, text: "Alexander Graham Bell received a patent for the telephone." }, // US Patent 174,465
  ],
  '03-08': [
    { year: 1917, text: "Women textile workers went on strike in Petrograd, beginning the Russian Revolution." }, // Julian calendar Feb 23
  ],
  '03-09': [
    { year: 1933, text: "Congress passed the Emergency Banking Act in a single day to stabilize the financial system." }, // First Hundred Days
  ],
  '03-10': [
    { year: 1876, text: "Alexander Graham Bell made the first telephone call, to his assistant in the next room." },
    { year: 1913, text: "Harriet Tubman died in Auburn, New York. She had never lost a passenger." },
  ],
  '03-11': [
    { year: 1918, text: "A mess cook in Kansas reported to the camp hospital with a fever, the first recorded case of the 1918 flu." }, // Fort Riley
  ],
  '03-12': [
    { year: 1930, text: "Mahatma Gandhi began a march to the sea to protest the British monopoly on salt." }, // Salt March
  ],
  '03-13': [
    { year: 1781, text: "William Herschel found Uranus from his back garden in Bath, and thought at first it was a comet." },
  ],
  '03-14': [
    { year: 1879, text: "Albert Einstein was born in Ulm." },
  ],
  '03-15': [
    { year: 1917, text: "Tsar Nicholas II abdicated the Russian throne, ending three centuries of Romanov rule." },
  ],
  '03-16': [
    { year: 1926, text: "Robert Goddard launched the first liquid-fueled rocket from a farm in Auburn. It flew for two and a half seconds." },
  ],
  '03-17': [
    { year: 1898, text: "John Philip Holland achieved the first successful submerged run of a modern submarine." }, // Holland VI
  ],
  '03-18': [
    { year: 1922, text: "British authorities sentenced Gandhi to six years in prison for sedition." },
  ],
  '03-19': [
    { year: 1932, text: "The Sydney Harbour Bridge opened to traffic after eight years of construction." },
  ],
  '03-20': [
    { year: 1852, text: "Uncle Tom's Cabin came out as a book and sold ten thousand copies in its first week." },
  ],
  '03-21': [
    { year: 1925, text: "Tennessee passed the Butler Act, making it illegal for public schools to teach human evolution." },
  ],
  '03-22': [
    { year: 1895, text: "The Lumiere brothers showed their first film, workers leaving a factory, to a private audience." }, // Paris
  ],
  '03-23': [
    { year: 1903, text: "The Wright brothers applied for a patent on their flying machine." }, // US Patent 821,393
  ],
  '03-24': [
    { year: 1882, text: "Robert Koch announced he had found the bacterium that causes tuberculosis." }, // Berlin Physiological Society
  ],
  '03-25': [
    { year: 1655, text: "Christiaan Huygens found Titan, the largest moon of Saturn." },
  ],
  '03-26': [
    { year: 1827, text: "Ludwig van Beethoven died in Vienna during a thunderstorm." },
  ],
  '03-27': [
    { year: 1912, text: "The mayor of Tokyo gave three thousand cherry trees to Washington, D.C." }, // Tidal Basin
  ],
  '03-28': [
    { year: 1939, text: "The Spanish Civil War ended as Nationalist troops took Madrid." },
  ],
  '03-29': [
    { year: 1912, text: "Robert Falcon Scott made the final entry in his diary before freezing to death in Antarctica." }, // Terra Nova expedition
  ],
  '03-30': [
    { year: 1867, text: "The United States agreed to buy Alaska from Russia for $7.2 million, about two cents an acre." },
  ],
  '03-31': [
    { year: 1889, text: "The Eiffel Tower opened, built as a temporary exhibit and never taken down." },
    { year: 1918, text: "Americans set their clocks forward for the first time, to save fuel for the war." }, // Standard Time Act
  ],
  '04-01': [
    { year: 1924, text: "Adolf Hitler was sentenced to five years in prison for the Beer Hall Putsch. He served nine months." }, // Landsberg Prison
    { year: 1918, text: "The Royal Flying Corps and Royal Naval Air Service merged to form the Royal Air Force." }, // United Kingdom
  ],
  '04-02': [
    { year: 1792, text: "Congress passed the Coinage Act, creating the United States Mint and the dollar." },
  ],
  '04-03': [
    { year: 1860, text: "The first Pony Express rider left St. Joseph, Missouri, with mail for California." },
  ],
  '04-04': [
    { year: 1949, text: "Twelve nations signed the North Atlantic Treaty in Washington, creating NATO." },
  ],
  '04-05': [
    { year: 1933, text: "Franklin Roosevelt issued an executive order banning the private hoarding of gold." }, // Executive Order 6102
  ],
  '04-06': [
    { year: 1896, text: "The first modern Olympic Games opened in Athens." },
    { year: 1909, text: "Robert Peary said he had reached the North Pole. Whether he did is still argued." },
  ],
  '04-07': [
    { year: 1927, text: "Bell Labs demonstrated long-distance television, broadcasting from Washington to New York." }, // Herbert Hoover speech
  ],
  '04-08': [
    { year: 1904, text: "Longacre Square in Manhattan was renamed Times Square." }, // New York Times headquarters
  ],
  '04-09': [
    { year: 1865, text: "Robert E. Lee surrendered to Ulysses S. Grant at Appomattox, ending the American Civil War." },
  ],
  '04-10': [
    { year: 1912, text: "The Titanic left Southampton on its first and only voyage." },
  ],
  '04-11': [
    { year: 1951, text: "President Truman relieved General Douglas MacArthur of his commands in Korea." },
  ],
  '04-12': [
    { year: 1861, text: "Confederate artillery opened fire on Fort Sumter in Charleston harbor, and the Civil War began." },
  ],
  '04-13': [
    { year: 1943, text: "The Jefferson Memorial was dedicated in Washington on the two hundredth anniversary of his birth." },
  ],
  '04-14': [
    { year: 1865, text: "John Wilkes Booth shot Abraham Lincoln in the back of the head at Ford's Theatre." },
  ],
  '04-15': [
    { year: 1452, text: "Leonardo da Vinci was born near the Tuscan town of Vinci." },
    { year: 1912, text: "The Titanic sank in the North Atlantic, less than three hours after striking an iceberg." },
  ],
  '04-16': [
    { year: 1947, text: "Bernard Baruch coined the term \"Cold War\" in a speech about relations with the Soviet Union." },
  ],
  '04-17': [
    { year: 1924, text: "Marcus Loew merged three film studios to create Metro-Goldwyn-Mayer." }, // MGM
  ],
  '04-18': [
    { year: 1906, text: "An earthquake shook San Francisco before dawn, and the fires that followed burned for days." },
  ],
  '04-19': [
    { year: 1775, text: "The first shots of the American Revolution were fired at Lexington and Concord." },
  ],
  '04-20': [
    { year: 1902, text: "Marie and Pierre Curie successfully isolated radioactive radium salts from pitchblende." },
  ],
  '04-21': [
    { year: 1918, text: "The Red Baron, Manfred von Richthofen, was shot down and killed over France." },
  ],
  '04-22': [
    { year: 1915, text: "German forces fired chlorine gas at Ypres, the first large-scale use of poison gas in war." }, // Second Battle of Ypres
  ],
  '04-23': [
    { year: 1838, text: "The Great Western reached New York, and crossing the Atlantic stopped depending on the wind." }, // first scheduled transatlantic steamship
    { year: 1616, text: "William Shakespeare died in Stratford, on or near his fifty-second birthday." },
  ],
  '04-24': [
    { year: 1800, text: "Congress set aside five thousand dollars for books, and the Library of Congress began." },
  ],
  '04-25': [
    { year: 1915, text: "Allied forces landed on the beaches of Gallipoli." }, // ANZAC Day
  ],
  '04-26': [
    { year: 1937, text: "German warplanes bombed the Basque town of Guernica for three hours." }, // Spanish Civil War
  ],
  '04-27': [
    { year: 1865, text: "The steamboat Sultana exploded on the Mississippi, killing well over a thousand people." }, // maritime disaster
  ],
  '04-28': [
    { year: 1947, text: "Thor Heyerdahl and a crew of five set sail from Peru on a balsa wood raft named Kon-Tiki." }, // Pacific crossing
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
  '05-02': [
    { year: 1933, text: "The first modern sighting of the Loch Ness Monster was reported by a local newspaper." }, // Inverness Courier
  ],
  '05-03': [
    { year: 1937, text: "Margaret Mitchell won the Pulitzer Prize for Gone with the Wind." },
  ],
  '05-04': [
    { year: 1904, text: "Construction began on the Panama Canal under the direction of the United States." },
  ],
  '05-05': [
    { year: 1821, text: "Napoleon Bonaparte died in exile on the remote island of St. Helena." }, // Longwood House
    { year: 1925, text: "John T. Scopes was charged with teaching evolution in a Tennessee school." }, // Dayton, Tennessee
  ],
  '05-06': [
    { year: 1840, text: "The Penny Black became valid, the first adhesive postage stamp." },
    { year: 1937, text: "The Hindenburg caught fire and was destroyed in less than a minute at Lakehurst." }, // New Jersey
  ],
  '05-07': [
    { year: 1915, text: "A German U-boat sank the Lusitania off the coast of Ireland, killing over a thousand people." },
  ],
  '05-08': [
    { year: 1945, text: "Britain and America celebrated Victory in Europe Day as German forces laid down their arms." },
  ],
  '05-09': [
    { year: 1926, text: "Richard Byrd and Floyd Bennett claimed to be the first to fly over the North Pole." },
  ],
  '05-10': [
    { year: 1869, text: "A golden spike joined the rails at Promontory Summit, and America had a railway coast to coast." }, // transcontinental railroad
    { year: 1908, text: "Anna Jarvis held the first Mother's Day service, in a church in Grafton, West Virginia." },
  ],
  '05-11': [
    { year: 1894, text: "Workers at the Pullman Palace Car Company went on strike near Chicago." },
  ],
  '05-12': [
    { year: 1932, text: "The body of the Lindbergh baby was found in the woods near the family home." },
  ],
  '05-13': [
    { year: 1940, text: "Winston Churchill told the House of Commons he had nothing to offer but blood, toil, tears and sweat." },
  ],
  '05-14': [
    { year: 1804, text: "Lewis and Clark started up the Missouri, under orders to keep going until they reached the sea." }, // Corps of Discovery
    { year: 1796, text: "Edward Jenner scratched cowpox into the arm of an eight-year-old boy, and vaccination began." }, // James Phipps
  ],
  '05-15': [
    { year: 1940, text: "Richard and Maurice McDonald opened their first restaurant in San Bernardino, California." },
  ],
  '05-16': [
    { year: 1929, text: "The first Academy Awards were handed out during a private dinner at the Hollywood Roosevelt Hotel." },
  ],
  '05-17': [
    { year: 1875, text: "The first Kentucky Derby was run at Louisville, and won by a horse called Aristides." },
  ],
  '05-18': [
    { year: 1896, text: "The Supreme Court ruled in Plessy v. Ferguson that segregated facilities were legal if they were equal." },
  ],
  '05-19': [
    { year: 1536, text: "Anne Boleyn was beheaded at the Tower of London on the orders of Henry VIII." },
  ],
  '05-20': [
    { year: 1873, text: "Levi Strauss and Jacob Davis patented riveted work pants, and blue jeans were born." }, // US 139,121
  ],
  '05-21': [
    { year: 1932, text: "Amelia Earhart put down in a Derry field, the first woman to fly the Atlantic alone." }, // five years to the day after Lindbergh
    { year: 1927, text: "Charles Lindbergh landed outside Paris, alone, after thirty-three hours in the air." },
  ],
  '05-22': [
    { year: 1906, text: "The Wright brothers received a US patent for their flying machine." }, // US 821,393
  ],
  '05-23': [
    { year: 1934, text: "Bonnie and Clyde were ambushed and killed by police on a rural road in Louisiana." },
  ],
  '05-24': [
    { year: 1930, text: "Amy Johnson landed in Darwin, the first woman to fly alone from England to Australia." }, // 19 days, in a secondhand Gipsy Moth
    { year: 1844, text: "Samuel Morse sent \"What hath God wrought\" by telegraph from Washington to Baltimore." },
    { year: 1883, text: "The Brooklyn Bridge opened, the longest suspension bridge in the world." },
  ],
  '05-25': [
    { year: 1935, text: "Jesse Owens broke three world records and tied a fourth in less than an hour in Michigan." }, // Ann Arbor
  ],
  '05-26': [
    { year: 1897, text: "Bram Stoker's Dracula was published in London." },
  ],
  '05-27': [
    { year: 1937, text: "The Golden Gate Bridge opened to pedestrians, a day before the cars." },
  ],
  '05-28': [
    { year: 1892, text: "John Muir and a group of friends founded the Sierra Club in San Francisco." },
  ],
  '05-29': [
    { year: 1919, text: "Arthur Eddington photographed a solar eclipse and caught starlight bending, as Einstein had said it would." }, // Principe
  ],
  '05-30': [
    { year: 1431, text: "Joan of Arc was burned at the stake in Rouen by the English." },
  ],
  '05-31': [
    { year: 1889, text: "A dam failed in Pennsylvania, sending a wall of water into Johnstown that killed over two thousand." },
  ],
  '06-01': [
    { year: 1938, text: "The first issue of Action Comics went on sale, bringing Superman to newsstands." },
  ],
  '06-02': [
    { year: 1896, text: "Guglielmo Marconi applied for a British patent for his wireless telegraph system." },
  ],
  '06-03': [
    { year: 1937, text: "The Duke of Windsor married Wallis Simpson in France, six months after giving up the British throne." },
  ],
  '06-04': [
    { year: 1783, text: "The Montgolfier brothers sent a paper balloon over a market square, with nobody aboard." }, // public demonstration at Annonay
    { year: 1896, text: "Henry Ford drove his first car out of a shed in Detroit, after knocking a hole in the wall to fit it through." }, // Quadricycle
  ],
  '06-05': [
    { year: 1883, text: "The first regularly scheduled Orient Express left Paris for Vienna." },
  ],
  '06-06': [
    { year: 1944, text: "Allied forces landed on the beaches of Normandy to begin the liberation of France." }, // Operation Overlord
    { year: 1933, text: "The first drive-in movie theater opened in a parking lot in Camden, New Jersey." }, // Richard Hollingshead
  ],
  '06-07': [
    { year: 1929, text: "The Vatican City became a sovereign state under the Lateran Treaty." },
  ],
  '06-08': [
    { year: 1949, text: "George Orwell published Nineteen Eighty-Four in London." },
  ],
  '06-09': [
    { year: 1934, text: "Donald Duck made his first screen appearance in a cartoon called The Wise Little Hen." },
  ],
  '06-10': [
    { year: 1692, text: "Bridget Bishop was hanged in Salem, the first person executed in the Massachusetts witch trials." },
  ],
  '06-11': [
    { year: 1776, text: "Congress appointed a committee of five men to draft a declaration of independence." },
  ],
  '06-12': [
    { year: 1939, text: "The National Baseball Hall of Fame opened in Cooperstown, New York." },
  ],
  '06-13': [
    { year: 1927, text: "A ticker tape parade in Manhattan celebrated Charles Lindbergh and his flight across the Atlantic." },
  ],
  '06-14': [
    { year: 1777, text: "Congress adopted a flag of thirteen stripes and thirteen stars." },
  ],
  '06-15': [
    { year: 1919, text: "Alcock and Brown came down in an Irish bog, having crossed the Atlantic without stopping." }, // first nonstop transatlantic flight
    { year: 1215, text: "King John set his seal to Magna Carta in a meadow at Runnymede." },
  ],
  '06-16': [
    { year: 1903, text: "Henry Ford and eleven investors incorporated the Ford Motor Company in Michigan." },
  ],
  '06-17': [
    { year: 1885, text: "The disassembled Statue of Liberty arrived in New York Harbor aboard a French ship." },
  ],
  '06-18': [
    { year: 1815, text: "The Duke of Wellington and Gebhard von Blucher defeated Napoleon at Waterloo." },
  ],
  '06-19': [
    { year: 1865, text: "Union troops reached Galveston with word that the enslaved people of Texas were free." }, // Juneteenth
  ],
  '06-20': [
    { year: 1837, text: "Queen Victoria came to the throne at eighteen, beginning a reign of sixty-three years." },
  ],
  '06-21': [
    { year: 1948, text: "Columbia Records introduced the long playing record, holding over twenty minutes of music per side." }, // LP format
  ],
  '06-22': [
    { year: 1941, text: "Germany invaded the Soviet Union, breaking their non-aggression pact." }, // Operation Barbarossa
  ],
  '06-23': [
    { year: 1868, text: "Christopher Sholes patented a typewriter. The keyboard came later." },
  ],
  '06-24': [
    { year: 1948, text: "Soviet forces blocked road and rail access to Berlin, and the airlift began." },
  ],
  '06-25': [
    { year: 1876, text: "George Custer and his men were killed at the Little Bighorn." },
  ],
  '06-26': [
    { year: 1945, text: "Fifty nations signed the United Nations Charter in San Francisco." },
  ],
  '06-27': [
    { year: 1898, text: "Joshua Slocum sailed into Newport, Rhode Island, the first person to sail alone around the world." }, // Spray
  ],
  '06-28': [
    { year: 1919, text: "The Treaty of Versailles was signed in the Hall of Mirrors." },
    { year: 1914, text: "Archduke Franz Ferdinand was assassinated in Sarajevo, setting the First World War in motion." },
  ],
  '06-29': [
    { year: 1613, text: "The Globe Theatre burned to the ground when a stage cannon misfired during a play." },
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
  '07-03': [
    { year: 1863, text: "Pickett's Charge failed at Gettysburg, ending the bloodiest battle of the American Civil War." }, // Pennsylvania
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
  '07-07': [
    { year: 1930, text: "Construction began on the Hoover Dam, putting thousands to work during the Great Depression." }, // Black Canyon
  ],
  '07-08': [
    { year: 1497, text: "Vasco da Gama sailed from Lisbon to look for a sea route to India, and found one." }, // returned 1499
    { year: 1889, text: "The first Wall Street Journal went on sale, four pages for two cents." },
  ],
  '07-09': [
    { year: 1877, text: "The first Wimbledon tennis championship began. Spencer Gore won the men's singles." }, // All England Club
  ],
  '07-10': [
    { year: 1925, text: "The Scopes Trial began in Tennessee, pitting Clarence Darrow against William Jennings Bryan." }, // Dayton
  ],
  '07-11': [
    { year: 1405, text: "Zheng He's fleet left for the western oceans, hundreds of ships and tens of thousands of men." }, // Maritime Day
    { year: 1804, text: "Aaron Burr shot Alexander Hamilton in a duel at Weehawken." },
  ],
  '07-12': [
    { year: 1862, text: "Congress authorized the Medal of Honor to recognize gallantry in action." }, // American Civil War
  ],
  '07-13': [
    { year: 1930, text: "The first FIFA World Cup kicked off in Uruguay with teams from thirteen nations." }, // Montevideo
  ],
  '07-14': [
    { year: 1789, text: "A crowd stormed the Bastille in Paris. It held seven prisoners." },
  ],
  '07-15': [
    { year: 1799, text: "French soldiers digging near Rashid found a stone carved in three scripts." }, // Rosetta Stone
  ],
  '07-16': [
    { year: 1945, text: "The first atomic bomb was detonated in the desert of New Mexico." }, // Trinity test
  ],
  '07-17': [
    { year: 1918, text: "The Russian royal family was executed by Bolsheviks in the basement of a house in Yekaterinburg." }, // Romanovs
  ],
  '07-18': [
    { year: 1863, text: "The 54th Massachusetts Infantry Regiment led a nighttime assault on Fort Wagner in South Carolina." }, // American Civil War
    { year: 1817, text: "Jane Austen died in Winchester at the age of forty-one." }, // English novelist
  ],
  '07-19': [
    { year: 1848, text: "The Seneca Falls Convention opened in New York to discuss the rights of women." }, // Lucretia Mott and Elizabeth Cady Stanton
  ],
  '07-20': [
    { year: 1881, text: "Sitting Bull surrendered to the United States Army in North Dakota, five years after Little Bighorn." }, // Fort Buford
  ],
  '07-21': [
    { year: 1861, text: "Spectators brought picnics to watch the First Battle of Bull Run, and fled when the Union line broke." }, // Manassas
  ],
  '07-22': [
    { year: 1933, text: "Wiley Post landed back in New York, the first person to fly around the world alone." }, // 7 days, 18 hours
    { year: 1587, text: "English colonists landed at Roanoke. Three years later nobody could find them." },
  ],
  '07-23': [
    { year: 1903, text: "The Ford Motor Company sold its first car to a dentist in Chicago." }, // Model A
  ],
  '07-24': [
    { year: 1911, text: "Hiram Bingham was led up a mountain in Peru to the ruins of Machu Picchu." },
  ],
  '07-25': [
    { year: 1909, text: "Louis Bleriot crossed the English Channel by air in thirty-seven minutes." }, // Calais to Dover
    { year: 1814, text: "George Stephenson's first locomotive, Blucher, hauled thirty tons of coal up a hill." }, // Killingworth
  ],
  '07-26': [
    { year: 1948, text: "Harry Truman signed an executive order ending racial segregation in the United States military." }, // Executive Order 9981
  ],
  '07-27': [
    { year: 1921, text: "Researchers in Toronto successfully isolated insulin, a turning point in treating diabetes." }, // Banting and Best
  ],
  '07-28': [
    { year: 1914, text: "Austria-Hungary declared war on Serbia, exactly a month after the Archduke was killed." },
  ],
  '07-29': [
    { year: 1948, text: "The first post-war Olympic Games opened in London." }, // XIV Olympiad
  ],
  '07-30': [
    { year: 1932, text: "Walt Disney released Flowers and Trees, the first cartoon in full Technicolor." },
  ],
  '07-31': [
    { year: 1790, text: "The United States issued its first patent, signed by George Washington, for making potash." }, // Samuel Hopkins
  ],
  '08-01': [
    { year: 1936, text: "Adolf Hitler opened the Olympic Games in Berlin." },
    { year: 1876, text: "President Ulysses S. Grant signed a proclamation admitting Colorado as the thirty-eighth state." }, // Centennial State
  ],
  '08-02': [
    { year: 1876, text: "Wild Bill Hickok was shot from behind while playing poker in a Deadwood saloon." }, // South Dakota
  ],
  '08-03': [
    { year: 1492, text: "Christopher Columbus set sail from Spain with three ships." }, // Niña, Pinta, Santa María
  ],
  '08-04': [
    { year: 1944, text: "Police raided the Secret Annex in Amsterdam and arrested Anne Frank and her family." }, // Prinsengracht 263
  ],
  '08-05': [
    { year: 1861, text: "Abraham Lincoln signed a bill creating the first federal income tax in the United States." }, // Revenue Act of 1861
  ],
  '08-06': [
    { year: 1926, text: "Gertrude Ederle swam the English Channel, two hours faster than any man had." },
  ],
  '08-07': [
    { year: 1947, text: "Thor Heyerdahl and his crew crashed the Kon-Tiki raft into a reef in Polynesia, ending their voyage." }, // Raroia
  ],
  '08-08': [
    { year: 1588, text: "English fire ships broke the formation of the Spanish Armada off Calais." }, // Battle of Gravelines
  ],
  '08-09': [
    { year: 1945, text: "The United States dropped a plutonium bomb on Nagasaki, effectively ending the Second World War." }, // Fat Man
  ],
  '08-10': [
    { year: 1846, text: "The Smithsonian Institution was founded with money left by a British scientist who never visited America." }, // James Smithson
  ],
  '08-11': [
    { year: 1934, text: "The first federal prisoners arrived at Alcatraz Island in San Francisco Bay." },
  ],
  '08-12': [
    { year: 1851, text: "Isaac Singer patented a sewing machine that could be used at home." },
  ],
  '08-13': [
    { year: 1913, text: "Harry Brearley poured acid on his new steel alloy and saw it did not stain or rust." }, // stainless steel
  ],
  '08-14': [
    { year: 1945, text: "Japan announced its surrender. Crowds in Times Square celebrated the end of the war." }, // V-J Day
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
  '08-18': [
    { year: 1587, text: "Virginia Dare was born at Roanoke, the first English child born in the Americas." }, // Roanoke Colony
  ],
  '08-19': [
    { year: 1934, text: "Voters in Germany overwhelmingly approved combining the offices of president and chancellor." }, // Hitler consolidating power
    { year: 1839, text: "The French government bought the patent for the daguerreotype and gave the invention to the world for free." }, // Paris
  ],
  '08-20': [
    { year: 1911, text: "A telegraph operator in New York sent a message around the world by commercial cable in twelve minutes." }, // The New York Times
  ],
  '08-21': [
    { year: 1911, text: "The Mona Lisa was stolen from the Louvre. It was gone for more than two years." },
  ],
  '08-22': [
    { year: 1485, text: "Richard III was killed at the Battle of Bosworth Field, ending the Wars of the Roses." },
  ],
  '08-23': [
    { year: 1927, text: "Sacco and Vanzetti were executed in Massachusetts, sparking protests around the world." },
  ],
  '08-24': [
    { year: 1814, text: "British troops set fire to the White House and the Capitol building in Washington." }, // Burning of Washington
  ],
  '08-25': [
    { year: 1944, text: "French and American troops marched into Paris, liberating the city from German occupation." },
  ],
  '08-26': [
    { year: 1920, text: "The Nineteenth Amendment took effect, and American women won the vote." },
  ],
  '08-27': [
    { year: 1859, text: "Edwin Drake struck oil at Titusville, Pennsylvania, sixty-nine feet down." },
    { year: 1883, text: "Krakatoa exploded. The sound was heard nearly three thousand miles away." },
  ],
  '08-28': [
    { year: 1833, text: "Slavery was abolished throughout the British Empire." }, // Slavery Abolition Act
  ],
  '08-29': [
    { year: 1949, text: "The Soviet Union successfully tested its first atomic bomb on the steppes of Kazakhstan." }, // RDS-1
  ],
  '08-30': [
    { year: 1901, text: "Hubert Cecil Booth patented the first powered vacuum cleaner in London." },
  ],
  '08-31': [
    { year: 1888, text: "Mary Ann Nichols was found dead in Whitechapel, the first victim of Jack the Ripper." }, // London
  ],
  '09-01': [
    { year: 1939, text: "German forces crossed the border into Poland, beginning the Second World War." }, // Invasion of Poland
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
  '09-05': [
    { year: 1774, text: "The First Continental Congress met in secret at Carpenters' Hall in Philadelphia." },
  ],
  '09-06': [
    { year: 1522, text: "The Victoria reached Spain with eighteen men aboard, the first ship to sail around the world." }, // Magellan and Elcano expedition
    { year: 1492, text: "Columbus left the Canary Islands and sailed west into open water." },
  ],
  '09-07': [
    { year: 1940, text: "German bombers began fifty-seven consecutive nights of raids on London." }, // The Blitz
  ],
  '09-08': [
    { year: 1565, text: "Spanish settlers founded St. Augustine in Florida, now the oldest city in the United States." },
  ],
  '09-09': [
    { year: 1776, text: "The Continental Congress officially named the new nation the United States of America." }, // replacing United Colonies
  ],
  '09-10': [
    { year: 1846, text: "Elias Howe received a patent for a sewing machine using a lockstitch design." }, // US 4,750
  ],
  '09-11': [
    { year: 1936, text: "President Franklin Roosevelt pressed a button in Washington to turn on the power at Boulder Dam." }, // Hoover Dam
  ],
  '09-12': [
    { year: 1940, text: "Four teenagers followed a dog into a hole near Lascaux and found cave walls painted with animals." },
  ],
  '09-13': [
    { year: 1848, text: "An explosion drove an iron rod straight through the skull of Phineas Gage, who walked away." }, // Vermont railway construction
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
  '09-18': [
    { year: 1851, text: "The New York Times published its first edition, calling itself a paper for all classes." },
  ],
  '09-19': [
    { year: 1893, text: "New Zealand gave women the vote, the first country in the world to do it." },
    { year: 1783, text: "A sheep, a duck and a rooster went up in a balloon at Versailles, and came down unhurt." },
  ],
  '09-20': [
    { year: 1519, text: "Magellan sailed west with five ships to look for a way through the Americas." }, // one ship finished the voyage
    { year: 1946, text: "The first Cannes Film Festival opened." },
  ],
  '09-21': [
    { year: 1937, text: "J.R.R. Tolkien published The Hobbit, introducing readers to Middle-earth." },
  ],
  '09-22': [
    { year: 1862, text: "Abraham Lincoln issued the preliminary Emancipation Proclamation." },
  ],
  '09-23': [
    { year: 1846, text: "Astronomers in Berlin found Neptune within a degree of where the math said it would be." }, // Galle, from Le Verrier's prediction
  ],
  '09-24': [
    { year: 1852, text: "Henri Giffard steered a steam powered airship from Paris to Trappes, the first powered flight." }, // 27 km
    { year: 1906, text: "Devils Tower in Wyoming became the first national monument." },
  ],
  '09-25': [
    { year: 1690, text: "Publick Occurrences was printed in Boston and immediately shut down by the colonial government." }, // first multi-page US newspaper
  ],
  '09-26': [
    { year: 1905, text: "Albert Einstein published a paper laying out his theory of special relativity." }, // Annalen der Physik
  ],
  '09-27': [
    { year: 1825, text: "The Stockton and Darlington opened, the first public railway worked by steam." }, // Locomotion No. 1
    { year: 1908, text: "The first Model T rolled out of Ford's Piquette Avenue plant in Detroit." },
  ],
  '09-28': [
    { year: 1928, text: "Alexander Fleming came back to an untidy lab and noticed what the mould had done." },
    { year: 1066, text: "William of Normandy landed at Pevensey with an army and a claim to the English throne." },
  ],
  '09-29': [
    { year: 1916, text: "John D. Rockefeller became the first person to achieve a confirmed personal wealth of one billion dollars." },
  ],
  '09-30': [
    { year: 1927, text: "Babe Ruth hit his sixtieth home run of the season at Yankee Stadium." },
  ],
  '10-01': [
    { year: 1890, text: "Congress made Yosemite a national park." },
  ],
  '10-02': [
    { year: 1950, text: "Charles Schulz published the first Peanuts comic strip in seven newspapers." },
  ],
  '10-03': [
    { year: 1863, text: "President Lincoln proclaimed a national day of Thanksgiving to be held in November." },
  ],
  '10-04': [
    { year: 1883, text: "The Orient Express departed Paris on its first official journey to Istanbul." },
  ],
  '10-05': [
    { year: 1921, text: "The World Series was broadcast on the radio for the first time." }, // KDKA Pittsburgh
  ],
  '10-06': [
    { year: 1889, text: "Thomas Edison showed his first motion picture in New Jersey." }, // Kinetophone
  ],
  '10-07': [
    { year: 1913, text: "Henry Ford's moving assembly line began producing Model T cars." }, // Highland Park
  ],
  '10-08': [
    { year: 1871, text: "A fire started in a barn on DeKoven Street and burned the center of Chicago." },
  ],
  '10-09': [
    { year: 1936, text: "Generators at Hoover Dam began transmitting electricity to Los Angeles." },
  ],
  '10-10': [
    { year: 1845, text: "The Naval School opened in Annapolis with fifty midshipmen." }, // US Naval Academy
  ],
  '10-11': [
    { year: 1911, text: "An armed uprising in Wuchang began the revolution that overthrew the Qing dynasty." }, // Chinese Revolution
  ],
  '10-12': [
    { year: 1492, text: "Columbus made landfall in the Americas on an island he called San Salvador." },
  ],
  '10-13': [
    { year: 1792, text: "The cornerstone of the White House was laid in Washington by George Washington and a group of Freemasons." },
  ],
  '10-14': [
    { year: 1947, text: "Chuck Yeager flew faster than sound over the Mojave, with two broken ribs he had not mentioned." }, // Bell X-1
    { year: 1926, text: "Winnie-the-Pooh was published in London." },
  ],
  '10-15': [
    { year: 1917, text: "Mata Hari was executed by a French firing squad for espionage." },
  ],
  '10-16': [
    { year: 1846, text: "A Boston surgeon removed a tumor from a patient put under with ether, and anesthesia went public." }, // Massachusetts General, "Ether Day"
  ],
  '10-17': [
    { year: 1931, text: "Al Capone was convicted of income tax evasion and sent to federal prison." },
  ],
  '10-18': [
    { year: 1867, text: "The United States formally took possession of Alaska after purchasing it from Russia." }, // Sitka
  ],
  '10-19': [
    { year: 1781, text: "Lord Cornwallis surrendered at Yorktown, effectively ending the American Revolutionary War." },
  ],
  '10-20': [
    { year: 1947, text: "The House Un-American Activities Committee began its hearings on communist influence in Hollywood." },
  ],
  '10-21': [
    { year: 1805, text: "Lord Nelson defeated the combined French and Spanish fleets at Trafalgar, but was killed in the battle." },
  ],
  '10-22': [
    { year: 1797, text: "Andre-Jacques Garnerin jumped from a balloon over Paris with a silk parachute, the first to do it." }, // Parc Monceau
  ],
  '10-23': [
    { year: 1915, text: "Tens of thousands marched up Fifth Avenue in New York demanding the right to vote for women." },
  ],
  '10-24': [
    { year: 1901, text: "Annie Edson Taylor went over Niagara Falls in a barrel on her sixty-third birthday, and lived." },
  ],
  '10-25': [
    { year: 1415, text: "An outnumbered English army under Henry V defeated the French in the mud at Agincourt." },
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
  '10-29': [
    { year: 1929, text: "The stock market collapsed on Black Tuesday, plunging the nation into the Great Depression." },
  ],
  '10-30': [
    { year: 1938, text: "Orson Welles broadcast The War of the Worlds as a series of news bulletins." },
  ],
  '10-31': [
    { year: 1517, text: "Martin Luther supposedly nailed his ninety-five theses to the door of the castle church in Wittenberg." },
  ],
  '11-01': [
    { year: 1512, text: "The ceiling of the Sistine Chapel was opened to the public, painted by Michelangelo." }, // Vatican City
  ],
  '11-02': [
    { year: 1920, text: "KDKA in Pittsburgh read out the presidential election returns, the first commercial radio broadcast." },
  ],
  '11-03': [
    { year: 1903, text: "Panama declared its independence from Colombia, clearing the way for a US-built canal." }, // supported by the US
  ],
  '11-04': [
    { year: 1922, text: "Howard Carter found the step that led down to Tutankhamun's tomb." },
    { year: 1879, text: "James Ritty patented the cash register, to stop the staff in his saloon helping themselves." },
  ],
  '11-05': [
    { year: 1605, text: "Guy Fawkes was found guarding explosives under the House of Lords, spoiling the Gunpowder Plot." }, // London
  ],
  '11-06': [
    { year: 1860, text: "Abraham Lincoln was elected president of the United States." },
  ],
  '11-07': [
    { year: 1917, text: "Bolsheviks seized power in Petrograd, beginning the Russian October Revolution." }, // Julian calendar Oct 25
  ],
  '11-08': [
    { year: 1895, text: "Wilhelm Rontgen noticed a screen glowing across his darkened lab, and discovered X-rays." },
  ],
  '11-09': [
    { year: 1906, text: "Theodore Roosevelt visited the Panama Canal, the first time a president traveled abroad in office." },
  ],
  '11-10': [
    { year: 1871, text: "Henry Morton Stanley found David Livingstone near Lake Tanganyika, having searched for months." }, // Ujiji
  ],
  '11-11': [
    { year: 1918, text: "The guns fell silent on the Western Front at eleven in the morning." },
  ],
  '11-12': [
    { year: 1927, text: "The Holland Tunnel opened to traffic, linking New York and New Jersey under the Hudson." },
  ],
  '11-13': [
    { year: 1940, text: "Walt Disney released Fantasia, introducing stereophonic sound to movie theaters." }, // Fantasound
  ],
  '11-14': [
    { year: 1889, text: "Nellie Bly left New York to see if she could travel around the world in less than eighty days." }, // New York World
  ],
  '11-15': [
    { year: 1904, text: "King C. Gillette patented the first safety razor with disposable blades." }, // US 775,134
  ],
  '11-16': [
    { year: 1933, text: "The United States and the Soviet Union formally established diplomatic relations." }, // Roosevelt and Litvinov
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
  '11-20': [
    { year: 1945, text: "Twenty-four former Nazi leaders went on trial for war crimes at Nuremberg." },
    { year: 1923, text: "Garrett Morgan received a patent for a three-position traffic signal to make street crossings safer." }, // US 1,475,024
  ],
  '11-21': [
    { year: 1783, text: "Two men rose over Paris in a hot air balloon, the first people to leave the ground." },
    { year: 1877, text: "Thomas Edison announced a machine that could record sound and play it back." },
  ],
  '11-22': [
    { year: 1718, text: "The pirate Blackbeard was cornered and killed in battle off the coast of North Carolina." }, // Ocracoke Inlet
  ],
  '11-23': [
    { year: 1889, text: "The first jukebox was installed in a saloon in San Francisco." }, // Palais Royale Saloon
  ],
  '11-24': [
    { year: 1859, text: "On the Origin of Species was published. The first printing sold out to booksellers the same day." },
  ],
  '11-25': [
    { year: 1915, text: "Albert Einstein presented the field equations of general relativity to the Prussian Academy." }, // Berlin
  ],
  '11-26': [
    { year: 1922, text: "Howard Carter and Lord Carnarvon stood before the sealed door of Tutankhamun's tomb." }, // Valley of the Kings
  ],
  '11-27': [
    { year: 1895, text: "Alfred Nobel signed his final will, setting aside his fortune to establish the Nobel Prizes." }, // Swedish-Norwegian Club
  ],
  '11-28': [
    { year: 1520, text: "Magellan sailed out of his treacherous strait and reached the open waters of the Pacific." }, // Strait of Magellan
  ],
  '11-29': [
    { year: 1929, text: "Richard Byrd flew over the South Pole and turned straight round, having dumped food to gain height." }, // 19 hours
    { year: 1890, text: "Army and Navy played football for the first time. Navy won." }, // 24-0, at West Point
  ],
  '11-30': [
    { year: 1835, text: "Mark Twain was born in Missouri, just as Halley's Comet appeared in the sky." }, // Florida, Missouri
  ],
  '12-01': [
    { year: 1913, text: "Ford introduced the first moving assembly line for an entire automobile, dropping the build time to hours." }, // Highland Park
  ],
  '12-02': [
    { year: 1942, text: "Under a stadium in Chicago, Enrico Fermi's team started the first nuclear chain reaction." }, // Chicago Pile-1, Stagg Field
  ],
  '12-03': [
    { year: 1910, text: "Georges Claude displayed the first neon lighting at the Paris Motor Show." }, // Grand Palais
  ],
  '12-04': [
    { year: 1791, text: "The Observer published its first issue in London, making it the oldest Sunday paper in the world." },
  ],
  '12-05': [
    { year: 1933, text: "Utah ratified the Twenty-first Amendment, officially ending Prohibition in the United States." },
  ],
  '12-06': [
    { year: 1884, text: "Engineers capped the Washington Monument with a pyramid of aluminum, a rare and precious metal." },
  ],
  '12-07': [
    { year: 1941, text: "Japanese naval forces launched a surprise attack on the US fleet anchored at Pearl Harbor." },
  ],
  '12-08': [
    { year: 1941, text: "Congress declared war on Japan, bringing the United States into the Second World War." },
  ],
  '12-09': [
    { year: 1905, text: "France passed a historic law separating church and state." },
  ],
  '12-10': [
    { year: 1901, text: "The first Nobel Prizes were awarded, five years to the day after Alfred Nobel died." },
  ],
  '12-11': [
    { year: 1936, text: "King Edward VIII abdicated the British throne so he could marry Wallis Simpson." }, // radio broadcast
  ],
  '12-12': [
    { year: 1901, text: "Guglielmo Marconi heard three faint clicks in Newfoundland, sent by radio from Cornwall." }, // the letter S, Signal Hill
  ],
  '12-13': [
    { year: 1577, text: "Francis Drake set sail from Plymouth on an expedition that would circle the globe." }, // Pelican
  ],
  '12-14': [
    { year: 1911, text: "Roald Amundsen reached the South Pole, five weeks ahead of Scott." },
    { year: 1900, text: "Max Planck told the German Physical Society that energy comes in small packets, and quantum theory began." },
  ],
  '12-15': [
    { year: 1791, text: "The Bill of Rights was ratified and went into effect as the first ten amendments." },
  ],
  '12-16': [
    { year: 1773, text: "Colonists dumped 342 chests of tea into Boston Harbor." },
  ],
  '12-17': [
    { year: 1903, text: "The Wright brothers flew at Kitty Hawk. The longest of the four flights lasted 59 seconds." },
    { year: 1790, text: "The Aztec sun stone was dug up under the main square of Mexico City." },
  ],
  '12-18': [
    { year: 1892, text: "Tchaikovsky's Nutcracker premiered in St. Petersburg to mostly terrible reviews." }, // Mariinsky Theatre
  ],
  '12-19': [
    { year: 1843, text: "Charles Dickens published A Christmas Carol. He paid for the printing himself." }, // London
  ],
  '12-20': [
    { year: 1803, text: "The United States formally took control of the Louisiana Purchase from France." }, // New Orleans
  ],
  '12-21': [
    { year: 1913, text: "The New York World printed the first crossword puzzle. It was shaped like a diamond." }, // Arthur Wynne, "word-cross"
  ],
  '12-22': [
    { year: 1894, text: "Alfred Dreyfus was wrongly convicted of treason in France, beginning a decade-long scandal." },
  ],
  '12-23': [
    { year: 1947, text: "Bell Labs showed off the transistor to its own executives, and kept quiet about it for six months." },
  ],
  '12-24': [
    { year: 1818, text: "Silent Night was sung for the first time, in a church in Oberndorf, to a guitar." },
  ],
  '12-25': [
    { year: 1066, text: "William the Conqueror was crowned King of England at Westminster Abbey on Christmas Day." },
  ],
  '12-26': [
    { year: 1898, text: "Marie and Pierre Curie announced they had found a new, highly radioactive element called radium." }, // French Academy of Sciences
  ],
  '12-27': [
    { year: 1831, text: "Charles Darwin set sail from Plymouth on HMS Beagle." },
  ],
  '12-28': [
    { year: 1895, text: "The Lumiere brothers held their first commercial film screening in a Paris cafe." }, // Salon Indien du Grand Cafe
  ],
  '12-29': [
    { year: 1170, text: "Thomas Becket was murdered in Canterbury Cathedral by four knights of Henry II." },
  ],
  '12-30': [
    { year: 1922, text: "The Union of Soviet Socialist Republics was formally established." }, // Moscow
  ],
  '12-31': [
    { year: 1879, text: "Thomas Edison gave the first public demonstration of his incandescent light bulb in New Jersey." }, // Menlo Park
  ]
};