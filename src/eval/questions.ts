// The gold questions: niche Simple English articles (small towns, minor
// species, obscure people) that the chat model can't answer from memory.
// `title` is the article that holds the answer (exact match with
// articles.title). `answers` are accepted spellings: a reply is correct if
// it contains one of them as a whole word.

type Question = {
  question: string;
  title: string;
  answers: string[];
};

export const questions: Question[] = [
  // Places
  {
    question: "What does the name of the town Loachapoka in Alabama mean?",
    title: "Loachapoka, Alabama",
    answers: ["turtle"],
  },
  {
    question: "What was the population of Miami, Arizona in the 2020 census?",
    title: "Miami, Arizona",
    answers: ["1,541", "1541"],
  },
  {
    question: "Which settlement is the wettest in Israel?",
    title: "Harashim",
    answers: ["Harashim"],
  },
  {
    question: "In what year was the village of Trump Heights founded?",
    title: "Trump Heights",
    answers: ["2019"],
  },
  {
    question: "How long is the island railway on Langeoog?",
    title: "Langeoog",
    answers: ["2.4"],
  },
  {
    question: "In which village is the Glastonbury Festival actually held?",
    title: "Glastonbury",
    answers: ["Pilton"],
  },
  {
    question:
      "Which nearby town do people from Ajitke Chattha visit for their basic needs?",
    title: "Ajitke Chattha",
    answers: ["Ali Pur"],
  },
  {
    question:
      "What was the population of Broadheath, Worcestershire in the 2001 census?",
    title: "Broadheath, Worcestershire",
    answers: ["1,713", "1713"],
  },
  {
    question:
      "What does the Icelandic river Hvítá become after it meets the Sog River?",
    title: "Hvítá",
    answers: ["Ölfusá"],
  },
  {
    question:
      "Which tribe's border is the Yarkon River in Israel described as in the Hebrew Bible?",
    title: "Yarkon River",
    answers: ["Dan"],
  },
  {
    question:
      "Which river does the King River in Victoria, Australia flow into?",
    title: "King River (Victoria)",
    answers: ["Ovens"],
  },
  {
    question: "The French river Viaur is a tributary of which river?",
    title: "Viaur",
    answers: ["Aveyron"],
  },
  {
    question:
      "Which river forms the southern border between Belize and Guatemala?",
    title: "Sarstoon River",
    answers: ["Sarstoon", "Sarstún"],
  },
  {
    question: "From which glacier does the Tawi River originate?",
    title: "Tawi River",
    answers: ["Kali Kundi"],
  },
  {
    question:
      "In Gemünden am Main, which river flows into the Franconian Saale?",
    title: "Gemünden am Main",
    answers: ["Sinn"],
  },
  {
    question: "Which French town is Titisee-Neustadt twinned with?",
    title: "Titisee-Neustadt",
    answers: ["Coulommiers"],
  },
  {
    question: "Which town in Michigan is Gunzenhausen in Bavaria twinned with?",
    title: "Gunzenhausen",
    answers: ["Frankenmuth"],
  },
  {
    question: "Since what year has Sigulda in Latvia had town rights?",
    title: "Sigulda",
    answers: ["1928"],
  },
  {
    question:
      "Who were the first settlers of the town of Adams in Green County, Wisconsin?",
    title: "Adams, Green County, Wisconsin",
    answers: ["Cornish"],
  },
  {
    question:
      "In what year did St Mary's Catholic School in Landover Hills, Maryland open?",
    title: "Landover Hills, Maryland",
    answers: ["1954"],
  },
  {
    question:
      "Which former commune merged with Belleville-sur-Vie to form Bellevigny?",
    title: "Bellevigny",
    answers: ["Saligny"],
  },
  {
    question:
      "What large Roman religious building was unearthed in Mackwiller in 1955?",
    title: "Mackwiller",
    answers: ["Mithraeum"],
  },
  {
    question:
      "Which former commune merged with Saint-Caprais-de-Blaye to form Val-de-Livenne?",
    title: "Val-de-Livenne",
    answers: ["Marcillac"],
  },
  {
    question:
      "Which former commune merged with Machecoul in 2016 to form a new commune?",
    title: "Machecoul-Saint-Même",
    answers: ["Saint-Même", "Saint-Meme"],
  },
  {
    question:
      "Between which two hills is the French commune of Mancenans located?",
    title: "Mancenans",
    answers: ["Châtel", "Chatel", "Replain"],
  },

  // Species
  {
    question: "What colour are the flowers of the swamp milkweed?",
    title: "Asclepias incarnata",
    answers: ["pink"],
  },
  {
    question: "At what age are red giant flying squirrel pups weaned?",
    title: "Red giant flying squirrel",
    answers: ["2.5", "two and a half"],
  },
  {
    question: "What is the scientific name of the variable antshrike?",
    title: "Variable antshrike",
    answers: ["Thamnophilus caerulescens"],
  },
  {
    question: "In which region is the bamboo Bambusa affinis found?",
    title: "Bambusa affinis",
    answers: ["Indo-China", "Indochina"],
  },
  {
    question: "What is the scientific name of the California tree frog?",
    title: "California tree frog",
    answers: ["Pseudacris cadaverina"],
  },
  {
    question: "In which countries is the caecilian Dermophis gracilior found?",
    title: "Dermophis gracilior",
    answers: ["Costa Rica", "Panama"],
  },
  {
    question:
      "How many wingbeats per second can the horned sungem make while hovering?",
    title: "Horned sungem",
    answers: ["90"],
  },

  // People
  {
    question: "In what year was Leslie Manigat elected President of Haiti?",
    title: "Leslie Manigat",
    answers: ["1988"],
  },
  {
    question:
      "In what year did Sylvia Bretschneider become speaker of the Mecklenburg-Vorpommern state assembly?",
    title: "Sylvia Bretschneider",
    answers: ["2002"],
  },
  {
    question:
      "In what year did George Little become leader of the New Brunswick New Democratic Party?",
    title: "George Little (New Brunswick politician)",
    answers: ["1980"],
  },
  {
    question:
      "In which Georgian presidential election was Giorgi Maisashvili a candidate?",
    title: "Giorgi Maisashvili",
    answers: ["2008"],
  },
  {
    question: "Which number Prime Minister of Gabon was Julien Nkoghe Bekale?",
    title: "Julien Nkoghe Bekale",
    answers: ["11th", "eleventh"],
  },
  {
    question: "What did Yevgeny Shaposhnikov die of?",
    title: "Yevgeny Shaposhnikov",
    answers: ["COVID-19", "COVID", "coronavirus"],
  },
  {
    question: "Which club in Eswatini was Faty Papy playing for when he died?",
    title: "Faty Papy",
    answers: ["Malanti"],
  },
  {
    question: "Where was the body of footballer Steve Gohouri found?",
    title: "Steve Gohouri",
    answers: ["Rhine"],
  },
  {
    question: "Where was Australian rules footballer Steve Marsh born?",
    title: "Steve Marsh (footballer)",
    answers: ["Kalgoorlie"],
  },
  {
    question: "Against which club did Jakob Jantscher score his first goal?",
    title: "Jakob Jantscher",
    answers: ["Altach"],
  },
  {
    question: "In which city did the Turkish painter Fikret Otyam die?",
    title: "Fikret Otyam",
    answers: ["Antalya"],
  },
  {
    question:
      "At which German design school did Tomás Maldonado work from 1954 to 1967?",
    title: "Tomás Maldonado",
    answers: ["Ulm"],
  },
  {
    question: "In which city did the art director Nikhil Baran Sengupta die?",
    title: "Nikhil Baran Sengupta",
    answers: ["Bhubaneswar"],
  },
  {
    question: "Which 1956 movie did Lorenza Mazzetti direct?",
    title: "Lorenza Mazzetti",
    answers: ["Together"],
  },

  // Music
  {
    question:
      "What position did Diana Ross's album Surrender reach on the UK chart?",
    title: "Surrender (Diana Ross album)",
    answers: ["10", "ten"],
  },
  {
    question:
      'In which country was the Mercury Rev song "Holes" released as a single?',
    title: "Holes (Mercury Rev song)",
    answers: ["Australia"],
  },
];
