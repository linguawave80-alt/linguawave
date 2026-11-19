// Used only if the phrase API is unreachable.
export const FALLBACK_PHRASES = {
    en: [
        { text: 'Hello, how are you today?', phonetic: '/hɛˈloʊ haʊ ɑːr juː təˈdeɪ/', topic: 'Greetings', translation: 'A friendly greeting', tip: 'Stress “hel-LO” with a rising tone.' },
        { text: 'Could you please repeat that?', phonetic: '/kʊd juː pliːz rɪˈpiːt ðæt/', topic: 'Communication', translation: 'Asking someone to say it again', tip: 'Link “could-you” smoothly.' },
        { text: 'I would like to order a coffee.', phonetic: '/aɪ wʊd laɪk tuː ˈɔːrdər ə ˈkɒfi/', topic: 'Food & Drink', translation: 'Ordering at a café', tip: '“Would like” is more polite than “want”.' },
    ],
    fr: [
        { text: 'Bonjour, comment allez-vous ?', phonetic: '/bɔ̃.ʒuʁ kɔ.mɑ̃ a.le vu/', topic: 'Greetings', translation: 'Good day, how are you?', tip: 'Keep the nasal vowel in “bon”.' },
        { text: 'Où se trouve la gare ?', phonetic: '/u sə tʁuv la ɡaʁ/', topic: 'Travel', translation: 'Where is the train station?', tip: 'The French R comes from the back of the throat.' },
    ],
    es: [
        { text: 'Buenos días, ¿cómo está usted?', phonetic: '/ˈbwenos ˈdias ˈkomo esˈta usˈteð/', topic: 'Greetings', translation: 'Good morning, how are you?', tip: 'The final “d” is soft.' },
        { text: 'Quisiera reservar una mesa para dos.', phonetic: '/kiˈsjera reseɾˈβaɾ ˈuna ˈmesa ˈpaɾa ðos/', topic: 'Restaurant', translation: 'I’d like to book a table for two.', tip: '“Quisiera” is the polite form of “want”.' },
    ],
    de: [
        { text: 'Guten Morgen, wie geht es Ihnen?', phonetic: '/ˈɡuːtn̩ ˈmɔʁɡn̩ viː ɡeːt ɛs ˈiːnən/', topic: 'Greetings', translation: 'Good morning, how are you?', tip: 'Make the “ch” sound soft.' },
    ],
    ja: [
        { text: 'こんにちは、お元気ですか？', phonetic: 'konnichiwa, o-genki desu ka', topic: 'Greetings', translation: 'Hello, how are you?', tip: 'Keep every syllable even in length.' },
    ],
    zh: [
        { text: '你好，你今天怎么样？', phonetic: 'nǐ hǎo, nǐ jīntiān zěnmeyàng', topic: 'Greetings', translation: 'Hello, how are you today?', tip: 'Tones change meaning — practice them.' },
    ],
    it: [
        { text: 'Buongiorno, come sta?', phonetic: '/bwonˈdʒorno ˈkome sta/', topic: 'Greetings', translation: 'Good morning, how are you?', tip: 'Roll the R lightly.' },
    ],
    pt: [
        { text: 'Olá, como você está hoje?', phonetic: '/oˈla ˈkomu voˈse esˈta ˈoʒi/', topic: 'Greetings', translation: 'Hello, how are you today?', tip: 'Brazilian “r” is soft.' },
    ],
};
