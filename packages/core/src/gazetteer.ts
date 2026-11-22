/**
 * A built-in list of places: the Middle East and North Africa in depth, and
 * capitals and large cities elsewhere. The API answers place search from it
 * until a geocoder is chosen (packages/api/src/places.ts), and the front
 * end's mock uses the same list.
 *
 * Rows are [English name, Arabic name, country in English, country in
 * Arabic, latitude, longitude, other spellings].
 */
import type { LngLat, PlaceResult } from "./model.js";

type Row = [en: string, ar: string, countryEn: string, countryAr: string, lat: number, lng: number, also?: string];

const OM: [string, string] = ["Oman", "عُمان"];
const AE: [string, string] = ["United Arab Emirates", "الإمارات"];
const SA: [string, string] = ["Saudi Arabia", "السعودية"];
const QA: [string, string] = ["Qatar", "قطر"];
const YE: [string, string] = ["Yemen", "اليمن"];
const IQ: [string, string] = ["Iraq", "العراق"];
const SY: [string, string] = ["Syria", "سوريا"];
const LB: [string, string] = ["Lebanon", "لبنان"];
const JO: [string, string] = ["Jordan", "الأردن"];
const PS: [string, string] = ["Palestine", "فلسطين"];
const IL: [string, string] = ["Israel", "إسرائيل"];
const EG: [string, string] = ["Egypt", "مصر"];
const LY: [string, string] = ["Libya", "ليبيا"];
const TN: [string, string] = ["Tunisia", "تونس"];
const DZ: [string, string] = ["Algeria", "الجزائر"];
const MA: [string, string] = ["Morocco", "المغرب"];
const SD: [string, string] = ["Sudan", "السودان"];
const TR: [string, string] = ["Türkiye", "تركيا"];
const IR: [string, string] = ["Iran", "إيران"];

const ROWS: Row[] = [
  /* Oman */
  ["Muscat", "مسقط", ...OM, 23.588, 58.383],
  ["Salalah", "صلالة", ...OM, 17.015, 54.092],
  ["Sohar", "صحار", ...OM, 24.347, 56.709],
  ["Nizwa", "نزوى", ...OM, 22.933, 57.53],
  ["Sur", "صور", ...OM, 22.567, 59.529],
  ["Seeb", "السيب", ...OM, 23.67, 58.189, "As Sib"],
  ["Barka", "بركاء", ...OM, 23.679, 57.886],
  ["Al Musanaah", "المصنعة", ...OM, 23.757, 57.636, "Musannah"],
  ["Al Suwaiq", "السويق", ...OM, 23.849, 57.438, "Suwayq"],
  ["Al Khaburah", "الخابورة", ...OM, 23.971, 57.093, "Khabourah"],
  ["Rustaq", "الرستاق", ...OM, 23.391, 57.424],
  ["Ibri", "عبري", ...OM, 23.225, 56.516],
  ["Khasab", "خصب", ...OM, 26.18, 56.247],
  ["Duqm", "الدقم", ...OM, 19.662, 57.705],
  /* Oman: the Batinah coast and Muscat, where Cyclone Shaheen came ashore */
  ["Saham", "صحم", ...OM, 24.172, 56.888],
  ["Liwa", "لوى", ...OM, 24.53, 56.567],
  ["Shinas", "شناص", ...OM, 24.743, 56.466],
  ["Quriyat", "قريات", ...OM, 23.264, 58.919],
  ["Bawshar", "بوشر", ...OM, 23.577, 58.399],
  ["Al Amerat", "العامرات", ...OM, 23.524, 58.497, "Amerat"],
  /* United Arab Emirates */
  ["Abu Dhabi", "أبوظبي", ...AE, 24.453, 54.377],
  ["Dubai", "دبي", ...AE, 25.205, 55.271],
  ["Sharjah", "الشارقة", ...AE, 25.346, 55.421],
  ["Al Ain", "العين", ...AE, 24.208, 55.745],
  ["Fujairah", "الفجيرة", ...AE, 25.129, 56.326],
  ["Ras Al Khaimah", "رأس الخيمة", ...AE, 25.79, 55.943],
  /* Saudi Arabia */
  ["Riyadh", "الرياض", ...SA, 24.713, 46.675],
  ["Jeddah", "جدة", ...SA, 21.485, 39.193, "Jidda"],
  ["Mecca", "مكة المكرمة", ...SA, 21.389, 39.858, "Makkah"],
  ["Medina", "المدينة المنورة", ...SA, 24.524, 39.569, "Madinah"],
  ["Dammam", "الدمام", ...SA, 26.42, 50.089],
  ["Tabuk", "تبوك", ...SA, 28.383, 36.567],
  ["Abha", "أبها", ...SA, 18.246, 42.511],
  ["Jazan", "جازان", ...SA, 16.889, 42.571, "Jizan"],
  ["Buraidah", "بريدة", ...SA, 26.326, 43.975],
  ["Hail", "حائل", ...SA, 27.512, 41.72],
  /* Qatar, Bahrain, Kuwait */
  ["Doha", "الدوحة", ...QA, 25.285, 51.531],
  ["Al Khor", "الخور", ...QA, 25.684, 51.506],
  ["Lusail", "لوسيل", ...QA, 25.43, 51.49],
  ["Al Wakrah", "الوكرة", ...QA, 25.171, 51.603],
  ["Manama", "المنامة", "Bahrain", "البحرين", 26.228, 50.586],
  ["Kuwait City", "مدينة الكويت", "Kuwait", "الكويت", 29.376, 47.977],
  /* Qatar: the World Cup host city that holds two stadiums */
  ["Al Rayyan", "الريان", ...QA, 25.292, 51.424],
  /* Yemen */
  ["Sanaa", "صنعاء", ...YE, 15.369, 44.191, "Sana'a"],
  ["Aden", "عدن", ...YE, 12.785, 45.019],
  ["Taiz", "تعز", ...YE, 13.579, 44.021],
  ["Hodeidah", "الحديدة", ...YE, 14.798, 42.954, "Al Hudaydah"],
  ["Mukalla", "المكلا", ...YE, 14.542, 49.124],
  ["Marib", "مأرب", ...YE, 15.463, 45.326],
  /* Iraq */
  ["Baghdad", "بغداد", ...IQ, 33.315, 44.366],
  ["Basra", "البصرة", ...IQ, 30.508, 47.783],
  ["Mosul", "الموصل", ...IQ, 36.34, 43.13],
  ["Erbil", "أربيل", ...IQ, 36.191, 44.009, "Irbil Hewler"],
  ["Najaf", "النجف", ...IQ, 31.996, 44.315],
  ["Karbala", "كربلاء", ...IQ, 32.616, 44.025],
  ["Kirkuk", "كركوك", ...IQ, 35.468, 44.392],
  ["Sulaymaniyah", "السليمانية", ...IQ, 35.557, 45.435],
  /* Syria */
  ["Damascus", "دمشق", ...SY, 33.513, 36.292],
  ["Aleppo", "حلب", ...SY, 36.202, 37.134],
  ["Homs", "حمص", ...SY, 34.732, 36.713],
  ["Hama", "حماة", ...SY, 35.132, 36.758],
  ["Latakia", "اللاذقية", ...SY, 35.531, 35.791],
  ["Idlib", "إدلب", ...SY, 35.931, 36.634],
  ["Deir ez-Zor", "دير الزور", ...SY, 35.336, 40.141, "Deir Ezzor"],
  ["Raqqa", "الرقة", ...SY, 35.95, 39.009],
  /* Syria: the north-west districts hit by the 2023 earthquake */
  ["Jindires", "جنديرس", ...SY, 36.393, 36.695, "Jandairis"],
  ["Harim", "حارم", ...SY, 36.207, 36.521, "Harem"],
  ["Salqin", "سلقين", ...SY, 36.138, 36.45],
  ["Atarib", "الأتارب", ...SY, 36.138, 36.83, "Al-Atarib"],
  ["Afrin", "عفرين", ...SY, 36.512, 36.869],
  ["Azaz", "أعزاز", ...SY, 36.586, 37.045, "Aazaz"],
  ["Al-Bab", "الباب", ...SY, 36.37, 37.517, "Al Bab"],
  /* Lebanon */
  ["Beirut", "بيروت", ...LB, 33.894, 35.502],
  ["Tripoli", "طرابلس", ...LB, 34.437, 35.85],
  ["Sidon", "صيدا", ...LB, 33.563, 35.369, "Saida"],
  ["Tyre", "صور", ...LB, 33.271, 35.196, "Sour"],
  /* Jordan */
  ["Amman", "عمّان", ...JO, 31.954, 35.911],
  ["Irbid", "إربد", ...JO, 32.556, 35.85],
  ["Zarqa", "الزرقاء", ...JO, 32.073, 36.088],
  ["Aqaba", "العقبة", ...JO, 29.532, 35.006],
  ["Mafraq", "المفرق", ...JO, 32.343, 36.208],
  ["Karak", "الكرك", ...JO, 31.185, 35.705],
  ["Ma'an", "معان", ...JO, 30.196, 35.734],
  ["Salt", "السلط", ...JO, 32.039, 35.727],
  ["Madaba", "مادبا", ...JO, 31.716, 35.794],
  ["Jerash", "جرش", ...JO, 32.281, 35.899],
  /* Jordan: the remaining governorate seats */
  ["Tafilah", "الطفيلة", ...JO, 30.837, 35.604, "Tafila"],
  ["Ajloun", "عجلون", ...JO, 32.333, 35.752, "Ajlun"],
  /* Palestine and Israel */
  ["Jerusalem", "القدس", "", "", 31.778, 35.235, "Al Quds"],
  ["Ramallah", "رام الله", ...PS, 31.903, 35.204],
  ["Gaza", "غزة", ...PS, 31.502, 34.467],
  ["Hebron", "الخليل", ...PS, 31.53, 35.095, "Al Khalil"],
  ["Nablus", "نابلس", ...PS, 32.222, 35.262],
  ["Tel Aviv", "تل أبيب", ...IL, 32.085, 34.782],
  ["Haifa", "حيفا", ...IL, 32.794, 34.99],
  /* Egypt */
  ["Cairo", "القاهرة", ...EG, 30.044, 31.236],
  ["Alexandria", "الإسكندرية", ...EG, 31.2, 29.919],
  ["Giza", "الجيزة", ...EG, 30.013, 31.209],
  ["Port Said", "بورسعيد", ...EG, 31.265, 32.302],
  ["Suez", "السويس", ...EG, 29.967, 32.55],
  ["Ismailia", "الإسماعيلية", ...EG, 30.596, 32.272],
  ["Luxor", "الأقصر", ...EG, 25.687, 32.64],
  ["Aswan", "أسوان", ...EG, 24.089, 32.9],
  ["El Alamein", "العلمين", ...EG, 30.83, 28.955],
  ["Mersa Matruh", "مرسى مطروح", ...EG, 31.354, 27.237, "Marsa Matrouh"],
  ["Sharm El Sheikh", "شرم الشيخ", ...EG, 27.916, 34.33],
  ["Arish", "العريش", ...EG, 31.132, 33.803],
  /* Egypt: the El Alamein coast */
  ["Sidi Abdel Rahman", "سيدي عبد الرحمن", ...EG, 30.97, 28.73, "Sidi Abd el Rahman"],
  ["El Dabaa", "الضبعة", ...EG, 31.033, 28.45, "El Daba"],
  /* Libya */
  ["Tripoli", "طرابلس", ...LY, 32.887, 13.191],
  ["Benghazi", "بنغازي", ...LY, 32.117, 20.069],
  ["Derna", "درنة", ...LY, 32.767, 22.639],
  ["Misrata", "مصراتة", ...LY, 32.375, 15.092],
  ["Tobruk", "طبرق", ...LY, 32.084, 23.958],
  ["Al Bayda", "البيضاء", ...LY, 32.763, 21.755],
  ["Sirte", "سرت", ...LY, 31.205, 16.588],
  ["Sabha", "سبها", ...LY, 27.038, 14.428],
  /* Libya: Jebel Akhdar, hit by Storm Daniel in 2023 */
  ["Shahhat", "شحات", ...LY, 32.828, 21.862, "Cyrene"],
  ["Susah", "سوسة", ...LY, 32.9, 21.962, "Apollonia"],
  ["Al Marj", "المرج", ...LY, 32.493, 20.83, "Marj"],
  /* Tunisia, Algeria, Morocco, Mauritania */
  ["Tunis", "تونس", ...TN, 36.806, 10.181],
  ["Sfax", "صفاقس", ...TN, 34.74, 10.76],
  ["Sousse", "سوسة", ...TN, 35.826, 10.637],
  ["Kairouan", "القيروان", ...TN, 35.678, 10.096],
  ["Algiers", "الجزائر العاصمة", ...DZ, 36.754, 3.059],
  ["Oran", "وهران", ...DZ, 35.698, -0.633],
  ["Constantine", "قسنطينة", ...DZ, 36.365, 6.615],
  ["Béjaïa", "بجاية", ...DZ, 36.751, 5.064],
  ["Annaba", "عنابة", ...DZ, 36.9, 7.767],
  ["Rabat", "الرباط", ...MA, 34.021, -6.842],
  ["Casablanca", "الدار البيضاء", ...MA, 33.573, -7.59],
  ["Marrakech", "مراكش", ...MA, 31.63, -7.99, "Marrakesh"],
  ["Fes", "فاس", ...MA, 34.033, -5.0, "Fez"],
  ["Tangier", "طنجة", ...MA, 35.76, -5.834],
  ["Agadir", "أكادير", ...MA, 30.428, -9.598],
  ["Taroudant", "تارودانت", ...MA, 30.47, -8.877],
  ["Ouarzazate", "ورزازات", ...MA, 30.919, -6.893],
  ["Nouakchott", "نواكشوط", "Mauritania", "موريتانيا", 18.079, -15.965],
  /* Morocco: Al Haouz, the 2023 earthquake */
  ["Amizmiz", "أمزميز", ...MA, 31.217, -8.233],
  ["Asni", "أسني", ...MA, 31.248, -7.98],
  ["Moulay Brahim", "مولاي إبراهيم", ...MA, 31.29, -7.96],
  ["Talat N'Yaaqoub", "تلات نيعقوب", ...MA, 30.99, -8.18, "Talat n Yacoub"],
  ["Ighil", "إيغيل", ...MA, 31.05, -8.41],
  ["Chichaoua", "شيشاوة", ...MA, 31.543, -8.763],
  /* Sudan and the Horn */
  ["Khartoum", "الخرطوم", ...SD, 15.5, 32.56],
  ["Omdurman", "أم درمان", ...SD, 15.644, 32.478],
  ["Port Sudan", "بورتسودان", ...SD, 19.616, 37.216],
  ["El Fasher", "الفاشر", ...SD, 13.628, 25.349],
  ["Wad Madani", "ود مدني", ...SD, 14.401, 33.52],
  ["Juba", "جوبا", "South Sudan", "جنوب السودان", 4.859, 31.571],
  ["Mogadishu", "مقديشو", "Somalia", "الصومال", 2.046, 45.318],
  ["Djibouti", "جيبوتي", "Djibouti", "جيبوتي", 11.588, 43.145],
  ["Asmara", "أسمرة", "Eritrea", "إريتريا", 15.322, 38.925],
  ["Addis Ababa", "أديس أبابا", "Ethiopia", "إثيوبيا", 9.03, 38.74],
  ["Moroni", "موروني", "Comoros", "جزر القمر", -11.704, 43.24],
  /* Sudan: towns on the Nile */
  ["Atbara", "عطبرة", "Sudan", "السودان", 17.702, 33.986],
  ["Dongola", "دنقلا", "Sudan", "السودان", 19.168, 30.475],
  ["Merowe", "مروي", "Sudan", "السودان", 18.483, 31.817],
  /* Türkiye and Iran */
  ["Ankara", "أنقرة", ...TR, 39.933, 32.86],
  ["Istanbul", "إسطنبول", ...TR, 41.008, 28.978],
  ["Izmir", "إزمير", ...TR, 38.423, 27.143],
  ["Adana", "أضنة", ...TR, 37.0, 35.321],
  ["Gaziantep", "غازي عنتاب", ...TR, 37.066, 37.383, "Antep"],
  ["Kahramanmaraş", "قهرمان مرعش", ...TR, 37.575, 36.937, "Maras"],
  ["Antakya", "أنطاكيا", ...TR, 36.202, 36.16, "Hatay Antioch"],
  ["İskenderun", "إسكندرون", ...TR, 36.587, 36.173, "Alexandretta"],
  ["Malatya", "ملاطية", ...TR, 38.355, 38.309],
  ["Adıyaman", "أديامان", ...TR, 37.764, 38.276],
  ["Şanlıurfa", "شانلي أورفا", ...TR, 37.167, 38.795, "Urfa"],
  ["Diyarbakır", "ديار بكر", ...TR, 37.914, 40.23],
  ["Tehran", "طهران", ...IR, 35.689, 51.389],
  ["Mashhad", "مشهد", ...IR, 36.297, 59.606],
  ["Isfahan", "أصفهان", ...IR, 32.655, 51.668, "Esfahan"],
  ["Shiraz", "شيراز", ...IR, 29.592, 52.584],
  ["Tabriz", "تبريز", ...IR, 38.08, 46.292],
  ["Bandar Abbas", "بندر عباس", ...IR, 27.183, 56.267],
  ["Chabahar", "تشابهار", ...IR, 25.292, 60.643],
  /* Türkiye: towns of the 2023 earthquake zone */
  ["Pazarcık", "بازارجك", "Türkiye", "تركيا", 37.49, 37.29, "Pazarcik"],
  ["Elbistan", "البستان", "Türkiye", "تركيا", 38.205, 37.198],
  ["Nurdağı", "نورداغي", "Türkiye", "تركيا", 37.177, 36.738, "Nurdagi"],
  ["İslahiye", "إصلاحية", "Türkiye", "تركيا", 37.026, 36.631, "Islahiye"],
  ["Gölbaşı", "غولباشي", "Türkiye", "تركيا", 37.637, 37.783, "Golbasi"],
  ["Osmaniye", "عثمانية", "Türkiye", "تركيا", 37.075, 36.25],
  ["Kırıkhan", "قرق خان", "Türkiye", "تركيا", 36.5, 36.358, "Kirikhan"],
  ["Samandağ", "سمنداغ", "Türkiye", "تركيا", 36.083, 35.977, "Samandag"],
  ["Türkoğlu", "توركأوغلو", "Türkiye", "تركيا", 37.383, 36.85, "Turkoglu"],
  /* South and Central Asia, the Caucasus */
  ["Kabul", "كابول", "Afghanistan", "أفغانستان", 34.555, 69.207],
  ["Islamabad", "إسلام آباد", "Pakistan", "باكستان", 33.684, 73.048],
  ["Karachi", "كراتشي", "Pakistan", "باكستان", 24.861, 67.01],
  ["New Delhi", "نيودلهي", "India", "الهند", 28.614, 77.209, "Delhi"],
  ["Mumbai", "مومباي", "India", "الهند", 19.076, 72.878, "Bombay"],
  ["Dhaka", "دكا", "Bangladesh", "بنغلاديش", 23.811, 90.413],
  ["Colombo", "كولومبو", "Sri Lanka", "سريلانكا", 6.927, 79.861],
  ["Kathmandu", "كاتماندو", "Nepal", "نيبال", 27.717, 85.324],
  ["Tashkent", "طشقند", "Uzbekistan", "أوزبكستان", 41.299, 69.24],
  ["Astana", "أستانا", "Kazakhstan", "كازاخستان", 51.169, 71.449],
  ["Baku", "باكو", "Azerbaijan", "أذربيجان", 40.409, 49.867],
  ["Yerevan", "يريفان", "Armenia", "أرمينيا", 40.179, 44.499],
  ["Tbilisi", "تبليسي", "Georgia", "جورجيا", 41.716, 44.783],
  /* Europe */
  ["London", "لندن", "United Kingdom", "المملكة المتحدة", 51.507, -0.128],
  ["Paris", "باريس", "France", "فرنسا", 48.857, 2.352],
  ["Berlin", "برلين", "Germany", "ألمانيا", 52.52, 13.405],
  ["Madrid", "مدريد", "Spain", "إسبانيا", 40.417, -3.704],
  ["Rome", "روما", "Italy", "إيطاليا", 41.903, 12.496],
  ["Athens", "أثينا", "Greece", "اليونان", 37.984, 23.728],
  ["Brussels", "بروكسل", "Belgium", "بلجيكا", 50.85, 4.352],
  ["Amsterdam", "أمستردام", "Netherlands", "هولندا", 52.368, 4.904],
  ["Vienna", "فيينا", "Austria", "النمسا", 48.208, 16.374],
  ["Geneva", "جنيف", "Switzerland", "سويسرا", 46.204, 6.143],
  ["Bern", "برن", "Switzerland", "سويسرا", 46.948, 7.447],
  ["Lisbon", "لشبونة", "Portugal", "البرتغال", 38.722, -9.139],
  ["Dublin", "دبلن", "Ireland", "أيرلندا", 53.35, -6.26],
  ["Stockholm", "ستوكهولم", "Sweden", "السويد", 59.329, 18.069],
  ["Oslo", "أوسلو", "Norway", "النرويج", 59.914, 10.752],
  ["Copenhagen", "كوبنهاغن", "Denmark", "الدنمارك", 55.676, 12.568],
  ["Helsinki", "هلسنكي", "Finland", "فنلندا", 60.17, 24.938],
  ["Warsaw", "وارسو", "Poland", "بولندا", 52.23, 21.012],
  ["Prague", "براغ", "Czechia", "التشيك", 50.076, 14.438],
  ["Budapest", "بودابست", "Hungary", "المجر", 47.498, 19.04],
  ["Bucharest", "بوخارست", "Romania", "رومانيا", 44.427, 26.103],
  ["Sofia", "صوفيا", "Bulgaria", "بلغاريا", 42.698, 23.322],
  ["Belgrade", "بلغراد", "Serbia", "صربيا", 44.787, 20.457],
  ["Kyiv", "كييف", "Ukraine", "أوكرانيا", 50.45, 30.523, "Kiev"],
  ["Moscow", "موسكو", "Russia", "روسيا", 55.756, 37.617],
  ["Nicosia", "نيقوسيا", "Cyprus", "قبرص", 35.186, 33.382],
  /* Greece: Evia, the 2021 wildfire */
  ["Evia", "إيفيا", "Greece", "اليونان", 38.6, 23.6, "Euboea Evvoia"],
  ["Chalkida", "خالكيدا", "Greece", "اليونان", 38.464, 23.599, "Chalcis Halkida Khalkis"],
  ["Limni", "ليمني", "Greece", "اليونان", 38.767, 23.317],
  ["Rovies", "روفيس", "Greece", "اليونان", 38.81, 23.229],
  ["Istiaia", "إستيايا", "Greece", "اليونان", 38.955, 23.153, "Histiaea Istiea"],
  ["Pefki", "بيفكي", "Greece", "اليونان", 38.995, 23.213, "Pefkoi"],
  ["Mantoudi", "مانتودي", "Greece", "اليونان", 38.797, 23.483],
  ["Agia Anna", "أغيا آنا", "Greece", "اليونان", 38.868, 23.401, "Ayia Anna"],
  ["Loutra Aidipsou", "لوترا إيديبسو", "Greece", "اليونان", 38.855, 23.047, "Edipsos Aidipsos"],
  /* The Americas */
  ["Washington", "واشنطن", "United States", "الولايات المتحدة", 38.907, -77.037, "Washington DC"],
  ["New York", "نيويورك", "United States", "الولايات المتحدة", 40.713, -74.006],
  ["Ottawa", "أوتاوا", "Canada", "كندا", 45.421, -75.697],
  ["Mexico City", "مكسيكو سيتي", "Mexico", "المكسيك", 19.433, -99.133],
  ["Havana", "هافانا", "Cuba", "كوبا", 23.114, -82.367],
  ["Bogotá", "بوغوتا", "Colombia", "كولومبيا", 4.711, -74.072],
  ["Caracas", "كاراكاس", "Venezuela", "فنزويلا", 10.481, -66.904],
  ["Lima", "ليما", "Peru", "بيرو", -12.046, -77.043],
  ["Brasília", "برازيليا", "Brazil", "البرازيل", -15.794, -47.883],
  ["Buenos Aires", "بوينس آيرس", "Argentina", "الأرجنتين", -34.604, -58.382],
  ["Santiago", "سانتياغو", "Chile", "تشيلي", -33.449, -70.669],
  /* East Asia and Oceania */
  ["Beijing", "بكين", "China", "الصين", 39.904, 116.407, "Peking"],
  ["Tokyo", "طوكيو", "Japan", "اليابان", 35.677, 139.65],
  ["Seoul", "سيول", "South Korea", "كوريا الجنوبية", 37.567, 126.978],
  ["Jakarta", "جاكرتا", "Indonesia", "إندونيسيا", -6.209, 106.846],
  ["Kuala Lumpur", "كوالالمبور", "Malaysia", "ماليزيا", 3.139, 101.687],
  ["Singapore", "سنغافورة", "Singapore", "سنغافورة", 1.352, 103.82],
  ["Bangkok", "بانكوك", "Thailand", "تايلاند", 13.756, 100.502],
  ["Hanoi", "هانوي", "Vietnam", "فيتنام", 21.028, 105.834],
  ["Manila", "مانيلا", "Philippines", "الفلبين", 14.6, 120.984],
  ["Canberra", "كانبرا", "Australia", "أستراليا", -35.281, 149.13],
  ["Wellington", "ويلينغتون", "New Zealand", "نيوزيلندا", -41.287, 174.776],
  /* Sub-Saharan Africa */
  ["Nairobi", "نيروبي", "Kenya", "كينيا", -1.292, 36.822],
  ["Kampala", "كمبالا", "Uganda", "أوغندا", 0.348, 32.583],
  ["Dar es Salaam", "دار السلام", "Tanzania", "تنزانيا", -6.792, 39.208],
  ["Kinshasa", "كينشاسا", "DR Congo", "الكونغو الديمقراطية", -4.441, 15.266],
  ["Lagos", "لاغوس", "Nigeria", "نيجيريا", 6.524, 3.379],
  ["Abuja", "أبوجا", "Nigeria", "نيجيريا", 9.077, 7.399],
  ["Accra", "أكرا", "Ghana", "غانا", 5.604, -0.187],
  ["Dakar", "داكار", "Senegal", "السنغال", 14.716, -17.467],
  ["Bamako", "باماكو", "Mali", "مالي", 12.639, -8.003],
  ["Niamey", "نيامي", "Niger", "النيجر", 13.512, 2.113],
  ["N'Djamena", "نجامينا", "Chad", "تشاد", 12.134, 15.056],
  ["Pretoria", "بريتوريا", "South Africa", "جنوب أفريقيا", -25.747, 28.229],
  ["Cape Town", "كيب تاون", "South Africa", "جنوب أفريقيا", -33.925, 18.424],
];

export const PLACE_COUNT = ROWS.length;

/**
 * One form for matching in either language: lower case, no Latin accents, no
 * Arabic vowel marks or tatweel, the hamza forms of alif folded to a bare
 * alif, ta marbuta to ha, alif maqsura to ya, and punctuation dropped.
 */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/['’`\-.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Indexed {
  row: Row;
  id: string;
  /** Folded names and spellings. */
  names: string[];
  /** Folded country names; a match here ranks below any name. */
  countries: string[];
}

const DEFINITE_ARTICLE = /^ال/;
const present = (key: string): boolean => key.length > 0;

const INDEX: Indexed[] = ROWS.map((row, i) => {
  const [english, arabic, countryEn, countryAr, , , also] = row;
  const arabicKey = fold(arabic);
  return {
    row,
    id: `place-${i + 1}`,
    names: [fold(english), arabicKey, arabicKey.replace(DEFINITE_ARTICLE, ""), fold(also ?? "")].filter(present),
    countries: [fold(countryEn), fold(countryAr)].filter(present),
  };
});

/** 0 exact, 1 starts with, 2 a word starts with, 3 contains; null for no match. */
function scoreKey(key: string, query: string): number | null {
  if (key === query) return 0;
  if (key.startsWith(query)) return 1;
  if (key.includes(` ${query}`)) return 2;
  return key.includes(query) ? 3 : null;
}

function best(keys: string[], query: string): number | null {
  let lowest: number | null = null;
  for (const key of keys) {
    const score = scoreKey(key, query);
    if (score !== null && (lowest === null || score < lowest)) lowest = score;
  }
  return lowest;
}

/** A name match, tried with and without the Arabic article; failing that, a country match, ranked after every name. */
function rank(entry: Indexed, query: string, bareQuery: string | null): number | null {
  const byName = best(entry.names, query) ?? (bareQuery === null ? null : best(entry.names, bareQuery));
  if (byName !== null) return byName;
  const byCountry = best(entry.countries, query);
  return byCountry === null ? null : byCountry + 4;
}

export function searchGazetteer(query: string, language: "ar" | "en", limit = 8): PlaceResult[] {
  const folded = fold(query);
  if (folded.length === 0) return [];
  const withoutArticle = folded.replace(DEFINITE_ARTICLE, "");
  const bareQuery = withoutArticle.length > 1 && withoutArticle !== folded ? withoutArticle : null;
  const matches: { entry: Indexed; score: number }[] = [];
  for (const entry of INDEX) {
    const score = rank(entry, folded, bareQuery);
    if (score !== null) matches.push({ entry, score });
  }
  matches.sort((a, b) => a.score - b.score || a.entry.row[0].localeCompare(b.entry.row[0]));
  return matches.slice(0, limit).map(({ entry }): PlaceResult => {
    const [english, arabic, countryEn, countryAr, lat, lng] = entry.row;
    const at: LngLat = [lng, lat];
    const span = 0.12;
    return {
      id: entry.id,
      name: language === "ar" ? { value: arabic, dir: "rtl" } : { value: english, dir: "ltr" },
      context: language === "ar" ? countryAr : countryEn,
      at,
      bounds: [
        [lng - span, lat - span],
        [lng + span, lat + span],
      ],
    };
  });
}
